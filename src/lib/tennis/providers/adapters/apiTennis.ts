/* ============================================================================
   API-Tennis (api-tennis.com) adapter. Contract per official docs
   (https://api-tennis.com/documentation, captured 2026-08):

     base:   https://api.api-tennis.com/tennis/
     auth:   query param `APIkey` (server-side only — sanitized before logging)
     shape:  GET ?method=<m>&APIkey=<k>&…  →  { success, result: [...] }

   Methods used: get_fixtures (schedule + results), get_standings (rankings),
   get_players (player), get_events (tournaments/event types).

   Documented limitations (honest, not worked around):
     - fixtures omit court surface → resolved via the factual tournament table,
       else defaulted with a `surface:unresolved` provenance marker;
     - fixtures omit best-of and environment → WTA⇒best_of_3 (a tour rule),
       ATP slam⇒best_of_5, else best_of_3; environment `unknown`.
   ========================================================================== */

import { z } from "zod";
import type { RankingSnapshot, TennisMatch, TennisPlayer, Tournament, TennisTour } from "../../domain";
import { normalizeName } from "../../data/identity";
import type { HttpRequest } from "../http";
import type { ScheduleQuery, HistoricalQuery } from "../types";
import {
  type LiveAdapter, type ParsedResult, parsed, parseFail,
  toRound, toMatchState, resolveSurfaceFromTournament,
  SURFACE_UNRESOLVED, seasonFromIso,
} from "./shared";

const NAME = "api-tennis";
const BASE = "https://api.api-tennis.com/tennis/";

const idString = z.union([z.string(), z.number()]).transform((v) => String(v));
const optIdString = idString.optional();

/** Envelope shared by every method. `result` shape is validated per method. */
const zEnvelope = z.object({
  success: z.union([z.number(), z.string()]).optional(),
  result: z.unknown().optional(),
  error: z.unknown().optional(),
});

const zFixture = z.object({
  event_key: idString,
  event_date: z.string().optional(),
  event_time: z.string().optional(),
  event_first_player: z.string().optional(),
  first_player_key: optIdString,
  event_second_player: z.string().optional(),
  second_player_key: optIdString,
  event_final_result: z.string().optional(),
  event_status: z.string().optional(),
  event_winner: z.string().optional(),
  event_type_type: z.string().optional(),
  tournament_name: z.string().optional(),
  tournament_key: optIdString,
  tournament_round: z.string().optional(),
  tournament_season: z.union([z.string(), z.number()]).optional(),
  scores: z.array(z.object({
    score_first: z.union([z.string(), z.number()]).optional(),
    score_second: z.union([z.string(), z.number()]).optional(),
    score_set: z.union([z.string(), z.number()]).optional(),
  }).passthrough()).optional(),
}).passthrough();

/** Build ordered SetScores from API-Tennis `scores[]` (per-set game counts). */
function setsFromScores(scores: z.infer<typeof zFixture>["scores"]): { homeGames: number; awayGames: number }[] {
  if (!scores || scores.length === 0) return [];
  const ordered = [...scores].sort((a, b) => Number(a.score_set ?? 0) - Number(b.score_set ?? 0));
  const out: { homeGames: number; awayGames: number }[] = [];
  for (const s of ordered) {
    const h = Number(s.score_first);
    const a = Number(s.score_second);
    if (!Number.isInteger(h) || !Number.isInteger(a) || h < 0 || a < 0) return []; // malformed → no fabricated sets
    out.push({ homeGames: h, awayGames: a });
  }
  return out;
}

const zStanding = z.object({
  place: z.union([z.string(), z.number()]),
  player: z.string(),
  player_key: idString,
  league: z.string().optional(),
  movement: z.string().optional(),
  country: z.string().optional(),
  points: z.union([z.string(), z.number()]).optional(),
}).passthrough();

const zPlayer = z.object({
  player_key: idString,
  player_name: z.string(),
  player_country: z.string().optional(),
  player_bday: z.string().optional(),
}).passthrough();

const zEventType = z.object({
  event_type_key: idString,
  event_type_type: z.string(),
}).passthrough();

// --- helpers ---------------------------------------------------------------

function tourFromEventType(eventType: string | undefined): TennisTour {
  const s = (eventType ?? "").toLowerCase();
  if (s.includes("wta")) return "wta";
  if (s.includes("challenger")) return "challenger";
  if (s.includes("itf")) return "itf";
  return "atp"; // ATP is the modal men's tour; documented default
}

const SLAMS = ["wimbledon", "roland garros", "french open", "us open", "australian open"];
function isSlam(name: string | undefined): boolean {
  const n = (name ?? "").toLowerCase();
  return SLAMS.some((k) => n.includes(k));
}

function url(method: string, key: string, params: Record<string, string | undefined>): string {
  const u = new URL(BASE);
  u.searchParams.set("method", method);
  u.searchParams.set("APIkey", key);
  for (const [k, v] of Object.entries(params)) if (v !== undefined) u.searchParams.set(k, v);
  return u.toString();
}

/** Pull the `result` array out of a validated envelope, or describe why not. */
function resultArray(raw: unknown): ParsedResult<unknown[]> {
  const env = zEnvelope.safeParse(raw);
  if (!env.success) return parseFail("response envelope did not validate");
  const { success, result } = env.data;
  if (Array.isArray(result)) return parsed(result);
  // success===0 with no array is an upstream error (often auth/entitlement).
  const ok = success === 1 || success === "1";
  if (!ok) return parseFail(`upstream success=${String(success)} with no result array`);
  return parseFail("result was not an array");
}

function mapFixture(f: z.infer<typeof zFixture>, now: number): TennisMatch | null {
  if (!f.event_first_player || !f.event_second_player) return null; // unmappable row
  const tour = tourFromEventType(f.event_type_type);
  const season = f.tournament_season !== undefined
    ? Number(f.tournament_season)
    : seasonFromIso(f.event_date, new Date(now).getUTCFullYear());
  const state = toMatchState(f.event_status)
    // event_winner set but no status ⇒ completed; else scheduled.
    ?? (f.event_winner ? "completed" : "scheduled");

  const resolvedSurface = resolveSurfaceFromTournament(f.tournament_name);
  const surface = resolvedSurface ?? "hard";

  // Per-set game counts come from `scores[]` (event_final_result is only the
  // sets-won summary, e.g. "2 - 1"). Only completed/retired matches carry sets.
  const sets = state === "completed" || state === "retired" ? setsFromScores(f.scores) : [];

  const homeWinner = f.event_winner === "First Player";
  const awayWinner = f.event_winner === "Second Player";

  const sources = [NAME];
  if (!resolvedSurface) sources.push(SURFACE_UNRESOLVED);

  return {
    id: `${NAME}:${f.event_key}`,
    tournamentId: f.tournament_key ? `${NAME}:${f.tournament_key}` : `${NAME}:unknown`,
    season: Number.isFinite(season) ? season : new Date(now).getUTCFullYear(),
    surface,
    environment: "unknown",
    format: tour === "wta" ? "best_of_3" : isSlam(f.tournament_name) ? "best_of_5" : "best_of_3",
    round: toRound(f.tournament_round) ?? "r32",
    state,
    startTime: f.event_date ? `${f.event_date}${f.event_time ? `T${f.event_time}` : ""}` : undefined,
    home: {
      playerId: f.first_player_key ? `${NAME}:${f.first_player_key}` : `${NAME}:home:${f.event_key}`,
      playerName: f.event_first_player,
      side: "home",
      isWinner: f.event_winner ? homeWinner : undefined,
    },
    away: {
      playerId: f.second_player_key ? `${NAME}:${f.second_player_key}` : `${NAME}:away:${f.event_key}`,
      playerName: f.event_second_player,
      side: "away",
      isWinner: f.event_winner ? awayWinner : undefined,
    },
    sets,
    stats: [],
    externalIds: { [NAME]: String(f.event_key) },
    sources,
  };
}

export const apiTennisAdapter: LiveAdapter = {
  name: NAME,
  baseUrl: BASE,
  apiKeyEnvVar: "API_TENNIS_API_KEY",
  capabilities: { schedule: true, results: true, rankings: true, players: true, historical: false },
  note: "Freemium; key passed as query param (server-side only, sanitized before logging).",

  buildSchedule(key: string, q: ScheduleQuery): HttpRequest {
    return { url: url("get_fixtures", key, { date_start: q.dateIso, date_stop: q.dateIso }) };
  },
  parseSchedule(raw: unknown, now: number): ParsedResult<TennisMatch[]> {
    const arr = resultArray(raw);
    if (!arr.ok) return arr;
    const out: TennisMatch[] = [];
    for (const row of arr.value) {
      const f = zFixture.safeParse(row);
      if (!f.success) continue; // unmappable row, not an envelope failure
      const m = mapFixture(f.data, now);
      if (m && m.state !== "completed" && m.state !== "retired") out.push(m);
    }
    return parsed(out);
  },

  buildResults(key: string, q: HistoricalQuery): HttpRequest {
    const start = `${q.season}-01-01`;
    const stop = `${q.season}-12-31`;
    return { url: url("get_fixtures", key, { date_start: start, date_stop: stop, event_type_key: undefined }) };
  },
  parseResults(raw: unknown, now: number): ParsedResult<TennisMatch[]> {
    const arr = resultArray(raw);
    if (!arr.ok) return arr;
    const out: TennisMatch[] = [];
    for (const row of arr.value) {
      const f = zFixture.safeParse(row);
      if (!f.success) continue;
      const m = mapFixture(f.data, now);
      if (m && (m.state === "completed" || m.state === "retired" || m.state === "walkover")) out.push(m);
    }
    return parsed(out);
  },

  buildRankings(key: string, tour: TennisTour): HttpRequest {
    const eventType = tour === "wta" ? "WTA" : "ATP";
    return { url: url("get_standings", key, { event_type: eventType }) };
  },
  parseRankings(raw: unknown, now: number): ParsedResult<RankingSnapshot[]> {
    const arr = resultArray(raw);
    if (!arr.ok) return arr;
    const asOf = new Date(now).toISOString().slice(0, 10);
    const out: RankingSnapshot[] = [];
    for (const row of arr.value) {
      const s = zStanding.safeParse(row);
      if (!s.success) continue;
      const rank = Number(s.data.place);
      if (!Number.isInteger(rank) || rank <= 0) continue; // never emit an invalid rank
      const league = (s.data.league ?? "").toLowerCase();
      const tour: TennisTour = league.includes("wta") ? "wta" : "atp";
      const points = s.data.points !== undefined ? Number(s.data.points) : undefined;
      out.push({
        playerId: `${NAME}:${s.data.player_key}`,
        tour,
        asOf,
        rank,
        points: points !== undefined && Number.isFinite(points) ? points : undefined,
      });
    }
    return parsed(out);
  },

  buildPlayer(key: string, externalId: string): HttpRequest {
    const playerKey = externalId.startsWith(`${NAME}:`) ? externalId.slice(NAME.length + 1) : externalId;
    return { url: url("get_players", key, { player_key: playerKey }) };
  },
  parsePlayer(raw: unknown, _now: number, _externalId: string): ParsedResult<TennisPlayer | null> {
    void _now; void _externalId;
    const arr = resultArray(raw);
    if (!arr.ok) return arr;
    if (arr.value.length === 0) return parsed(null);
    const p = zPlayer.safeParse(arr.value[0]);
    if (!p.success) return parseFail("player row did not validate");
    const d = p.data;
    return parsed({
      id: `${NAME}:${d.player_key}`,
      fullName: d.player_name,
      normalizedName: normalizeName(d.player_name),
      tour: "atp", // API-Tennis get_players does not disambiguate tour; resolved later
      countryCode: d.player_country || undefined,
      dateOfBirth: d.player_bday || undefined,
      plays: "unknown",
      backhand: "unknown",
      externalIds: { [NAME]: String(d.player_key) },
    });
  },

  buildTournaments(key: string): HttpRequest {
    return { url: url("get_events", key, {}) };
  },
  parseTournaments(raw: unknown, _now: number): ParsedResult<Tournament[]> {
    void _now;
    // get_events returns event *types*, not full tournaments with surface/dates;
    // we expose them as coarse tournament stubs and never invent surface/dates.
    const arr = resultArray(raw);
    if (!arr.ok) return arr;
    // API-Tennis event types lack surface/season → we cannot build a valid
    // Tournament (surface/season required) without fabricating. Report none.
    for (const row of arr.value) { void zEventType.safeParse(row); }
    return parsed([]);
  },
};
