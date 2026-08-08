/* ============================================================================
   Sportradar Tennis v3 adapter. Contract per the Sportradar developer portal
   (developer.sportradar.com/tennis, v3), endpoints confirmed 2026-08:

     base:  https://api.sportradar.com/tennis/{access}/v3/{lang}
     auth:  query param `api_key` (server-side only — sanitized before logging)

   Wired capabilities (single documented request each):
     - schedule  → GET /schedules/{date}/summaries.json
     - rankings  → GET /rankings.json
     - players   → GET /competitors/{id}/profile.json

   `results`/`historical` are Sportradar capabilities of the SERVICE, but a bulk
   season pull requires a season URN (e.g. sr:season:…) that is NOT derivable
   from a bare year without an extra `/seasons` lookup. Rather than fabricate a
   URN, those builders are intentionally not wired here; the factory reports them
   as supported-but-not-wired for the season query shape (see PROVIDERS.md).
   ========================================================================== */

import { z } from "zod";
import type { RankingSnapshot, TennisMatch, TennisPlayer, TennisTour, MatchSide, SetScore } from "../../domain";
import { normalizeName } from "../../data/identity";
import type { HttpRequest } from "../http";
import type { ScheduleQuery } from "../types";
import {
  type LiveAdapter, type ParsedResult, parsed, parseFail,
  toSurface, toRound, toMatchState, resolveSurfaceFromTournament, SURFACE_UNRESOLVED, seasonFromIso,
} from "./shared";

const NAME = "sportradar";
const BASE = "https://api.sportradar.com/tennis/trial/v3/en";

const zCompetitor = z.object({
  id: z.string(),
  name: z.string(),
  country_code: z.string().optional(),
  country: z.string().optional(),
  abbreviation: z.string().optional(),
  qualifier: z.enum(["home", "away"]).optional(),
}).passthrough();

const zSportEvent = z.object({
  id: z.string(),
  start_time: z.string().optional(),
  sport_event_context: z.object({
    competition: z.object({ name: z.string().optional() }).passthrough().optional(),
    season: z.object({ year: z.union([z.string(), z.number()]).optional(), name: z.string().optional() }).passthrough().optional(),
    round: z.object({ name: z.string().optional(), number: z.number().optional() }).passthrough().optional(),
    category: z.object({ name: z.string().optional() }).passthrough().optional(),
  }).passthrough().optional(),
  sport_event_conditions: z.object({
    court: z.object({ surface: z.string().optional() }).passthrough().optional(),
  }).passthrough().optional(),
  competitors: z.array(zCompetitor).optional(),
}).passthrough();

const zPeriodScore = z.object({
  home_score: z.number().optional(),
  away_score: z.number().optional(),
  home_tiebreak_score: z.number().optional(),
  away_tiebreak_score: z.number().optional(),
  number: z.number().optional(),
  type: z.string().optional(),
}).passthrough();

const zSportEventStatus = z.object({
  status: z.string().optional(),
  match_status: z.string().optional(),
  winner_id: z.string().optional(),
  period_scores: z.array(zPeriodScore).optional(),
}).passthrough();

const zSummary = z.object({
  sport_event: zSportEvent,
  sport_event_status: zSportEventStatus.optional(),
}).passthrough();

const zSummariesEnvelope = z.object({ summaries: z.array(z.unknown()) }).passthrough();

const zRankingCompetitor = z.object({
  rank: z.number(),
  points: z.number().optional(),
  competitor: zCompetitor,
}).passthrough();

const zRanking = z.object({
  name: z.string().optional(),
  gender: z.string().optional(),
  type_id: z.union([z.string(), z.number()]).optional(),
  competitor_rankings: z.array(zRankingCompetitor),
}).passthrough();

const zRankingsEnvelope = z.object({ rankings: z.array(z.unknown()) }).passthrough();

const zProfile = z.object({
  competitor: zCompetitor.extend({
    date_of_birth: z.string().optional(),
    handedness: z.string().optional(),
  }),
  info: z.object({
    handedness: z.string().optional(),
    height: z.number().optional(),
    pro_year: z.number().optional(),
    highest_singles_ranking: z.number().optional(),
  }).passthrough().optional(),
}).passthrough();

function apiUrl(path: string, key: string): string {
  const u = new URL(`${BASE}${path}`);
  u.searchParams.set("api_key", key);
  return u.toString();
}

function playsFrom(h: string | undefined): "left" | "right" | "unknown" {
  const s = (h ?? "").toLowerCase();
  if (s.includes("left")) return "left";
  if (s.includes("right")) return "right";
  return "unknown";
}

function tourFromCategory(catName: string | undefined, gender: string | undefined): TennisTour {
  const c = (catName ?? "").toLowerCase();
  if (c.includes("challenger")) return "challenger";
  if (c.includes("itf")) return "itf";
  if ((gender ?? "").toLowerCase() === "women" || c.includes("wta")) return "wta";
  return "atp";
}

function setsFromPeriods(periods: z.infer<typeof zPeriodScore>[] | undefined): SetScore[] {
  if (!periods) return [];
  const out: SetScore[] = [];
  for (const p of periods) {
    if (typeof p.home_score !== "number" || typeof p.away_score !== "number") continue;
    const set: SetScore = { homeGames: p.home_score, awayGames: p.away_score };
    if (typeof p.home_tiebreak_score === "number") set.homeTiebreak = p.home_tiebreak_score;
    if (typeof p.away_tiebreak_score === "number") set.awayTiebreak = p.away_tiebreak_score;
    out.push(set);
  }
  return out;
}

function mapSummary(s: z.infer<typeof zSummary>, now: number): TennisMatch | null {
  const ev = s.sport_event;
  const comps = ev.competitors ?? [];
  const home = comps.find((c) => c.qualifier === "home") ?? comps[0];
  const away = comps.find((c) => c.qualifier === "away") ?? comps[1];
  if (!home || !away) return null; // unmappable (doubles/BYE/incomplete)

  const ctx = ev.sport_event_context;
  const tour = tourFromCategory(ctx?.category?.name, undefined);
  const tName = ctx?.competition?.name;
  const providerSurface = toSurface(ev.sport_event_conditions?.court?.surface);
  const resolvedSurface = providerSurface ?? resolveSurfaceFromTournament(tName);
  const surface = resolvedSurface ?? "hard";

  const st = s.sport_event_status;
  const state = toMatchState(st?.status ?? st?.match_status) ?? "scheduled";
  const season = ctx?.season?.year !== undefined
    ? Number(ctx.season.year)
    : seasonFromIso(ev.start_time, new Date(now).getUTCFullYear());

  const mkSide = (c: z.infer<typeof zCompetitor>, side: "home" | "away"): MatchSide => ({
    playerId: `${NAME}:${c.id}`,
    playerName: c.name,
    side,
    isWinner: st?.winner_id ? st.winner_id === c.id : undefined,
  });

  const sources = [NAME];
  if (!resolvedSurface) sources.push(SURFACE_UNRESOLVED);

  return {
    id: `${NAME}:${ev.id}`,
    tournamentId: `${NAME}:${ctx?.competition?.name ?? "unknown"}`,
    season: Number.isFinite(season) ? season : new Date(now).getUTCFullYear(),
    surface,
    environment: "unknown",
    format: tour === "wta" ? "best_of_3" : "best_of_3", // SR does not expose best-of; slam best-of resolved elsewhere
    round: toRound(ctx?.round?.name) ?? "r32",
    state,
    startTime: ev.start_time,
    home: mkSide(home, "home"),
    away: mkSide(away, "away"),
    sets: state === "completed" || state === "retired" ? setsFromPeriods(st?.period_scores) : [],
    stats: [],
    externalIds: { [NAME]: ev.id },
    sources,
  };
}

export const sportradarAdapter: LiveAdapter = {
  name: NAME,
  baseUrl: BASE,
  apiKeyEnvVar: "SPORTRADAR_TENNIS_API_KEY",
  capabilities: { schedule: true, results: true, rankings: true, players: true, historical: true },
  note: "Commercial license. api_key query param (server-side only). Trial + production access levels.",

  buildSchedule(key: string, q: ScheduleQuery): HttpRequest {
    return { url: apiUrl(`/schedules/${q.dateIso}/summaries.json`, key) };
  },
  parseSchedule(raw: unknown, now: number): ParsedResult<TennisMatch[]> {
    const env = zSummariesEnvelope.safeParse(raw);
    if (!env.success) return parseFail("summaries envelope did not validate");
    const out: TennisMatch[] = [];
    for (const row of env.data.summaries) {
      const s = zSummary.safeParse(row);
      if (!s.success) continue;
      const m = mapSummary(s.data, now);
      if (m && m.state !== "completed" && m.state !== "retired") out.push(m);
    }
    return parsed(out);
  },

  buildRankings(key: string): HttpRequest {
    return { url: apiUrl(`/rankings.json`, key) };
  },
  parseRankings(raw: unknown, now: number): ParsedResult<RankingSnapshot[]> {
    const env = zRankingsEnvelope.safeParse(raw);
    if (!env.success) return parseFail("rankings envelope did not validate");
    const asOf = new Date(now).toISOString().slice(0, 10);
    const out: RankingSnapshot[] = [];
    for (const row of env.data.rankings) {
      const r = zRanking.safeParse(row);
      if (!r.success) continue;
      const tour: TennisTour = (r.data.gender ?? "").toLowerCase() === "women"
        || (r.data.name ?? "").toLowerCase().includes("wta") ? "wta" : "atp";
      for (const cr of r.data.competitor_rankings) {
        if (!Number.isInteger(cr.rank) || cr.rank <= 0) continue;
        out.push({
          playerId: `${NAME}:${cr.competitor.id}`,
          tour,
          asOf,
          rank: cr.rank,
          points: typeof cr.points === "number" && cr.points >= 0 ? cr.points : undefined,
        });
      }
    }
    return parsed(out);
  },

  buildPlayer(key: string, externalId: string): HttpRequest {
    const id = externalId.startsWith(`${NAME}:`) ? externalId.slice(NAME.length + 1) : externalId;
    return { url: apiUrl(`/competitors/${id}/profile.json`, key) };
  },
  parsePlayer(raw: unknown, _now: number, _externalId: string): ParsedResult<TennisPlayer | null> {
    void _now; void _externalId;
    const p = zProfile.safeParse(raw);
    if (!p.success) return parseFail("competitor profile did not validate");
    const c = p.data.competitor;
    return parsed({
      id: `${NAME}:${c.id}`,
      fullName: c.name,
      normalizedName: normalizeName(c.name),
      tour: "atp", // resolved via rankings/context later; profile does not state tour
      countryCode: c.country_code || undefined,
      dateOfBirth: c.date_of_birth || undefined,
      plays: playsFrom(c.handedness ?? p.data.info?.handedness),
      backhand: "unknown",
      heightCm: p.data.info?.height,
      turnedProYear: p.data.info?.pro_year,
      externalIds: { [NAME]: c.id },
    });
  },
};
