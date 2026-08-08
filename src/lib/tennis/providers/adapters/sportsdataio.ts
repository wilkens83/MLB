/* ============================================================================
   SportsDataIO Tennis adapter (api.sportsdata.io/v3/tennis).

     auth:  `Ocp-Apim-Subscription-Key` header (server-side only). SportsDataIO
            also accepts `?key=`, but the header form keeps the key out of the URL
            (and therefore out of any log line) — preferred here.

   Wired capabilities:
     - schedule → GET /scores/json/GamesByDate/{date}
     - results  → GET /scores/json/Games/{season}
     - players  → GET /scores/json/Players

   Honesty note: SportsDataIO's exact JSON field names live behind its developer
   portal, which is not fetchable without an account. This adapter maps the
   documented v3/tennis shape and DEFENSIVELY accepts known field-name variants
   (PlayerOneId | Player1Id, etc.) rather than inventing a single spelling. Field
   names MUST be re-confirmed against a live payload when a credential is obtained
   — a sanitized contract fixture is captured at that point. Until then this
   provider's live status is BLOCKED_CREDENTIAL and it is never marked READY.
   `rankings` is a declared service capability but is left unwired here because the
   rankings endpoint/fields could not be verified — we do not fabricate an
   endpoint (see PROVIDERS.md).
   ========================================================================== */

import { z } from "zod";
import type { TennisMatch, TennisPlayer, MatchSide, SetScore } from "../../domain";
import { normalizeName } from "../../data/identity";
import type { HttpRequest } from "../http";
import type { ScheduleQuery, HistoricalQuery } from "../types";
import {
  type LiveAdapter, type ParsedResult, parsed, parseFail,
  toSurface, toRound, toMatchState, resolveSurfaceFromTournament, SURFACE_UNRESOLVED, seasonFromIso,
} from "./shared";

const NAME = "sportsdataio";
const BASE = "https://api.sportsdata.io/v3/tennis";

const num = z.union([z.number(), z.string()]).optional();
const str = z.string().optional();

/** Defensive Game schema: accepts documented + known-variant field spellings. */
const zSet = z.object({
  Number: z.number().optional(),
  SetNumber: z.number().optional(),
  PlayerOneScore: num, PlayerTwoScore: num,
  Player1Score: num, Player2Score: num,
  PlayerOneTiebreakScore: num, PlayerTwoTiebreakScore: num,
}).passthrough();

const zGame = z.object({
  GameId: num,
  CompetitionName: str, TournamentName: str,
  Season: num,
  Round: str, RoundName: str,
  Day: str, DateTime: str,
  Status: str,
  Surface: str,
  Winner: str,
  PlayerOneId: num, Player1Id: num,
  PlayerTwoId: num, Player2Id: num,
  PlayerOne: str, Player1: str,
  PlayerTwo: str, Player2: str,
  Sets: z.array(zSet).optional(),
}).passthrough();

const zPlayer = z.object({
  PlayerId: num,
  FirstName: str, LastName: str, CommonName: str,
  BirthDate: str,
  Nationality: str, BirthCountry: str,
  Hand: str, PlayingHand: str,
  Height: z.number().optional(),
}).passthrough();

const coalesce = <T>(...vals: (T | undefined)[]): T | undefined => vals.find((v) => v !== undefined);
const toNum = (v: number | string | undefined): number | undefined => {
  if (v === undefined) return undefined;
  const n = typeof v === "string" ? Number(v) : v;
  return Number.isFinite(n) ? n : undefined;
};

function setsFromGame(sets: z.infer<typeof zSet>[] | undefined): SetScore[] {
  if (!sets) return [];
  const out: SetScore[] = [];
  const ordered = [...sets].sort((a, b) => (coalesce(a.Number, a.SetNumber) ?? 0) - (coalesce(b.Number, b.SetNumber) ?? 0));
  for (const s of ordered) {
    const h = toNum(coalesce(s.PlayerOneScore, s.Player1Score));
    const a = toNum(coalesce(s.PlayerTwoScore, s.Player2Score));
    if (h === undefined || a === undefined || !Number.isInteger(h) || !Number.isInteger(a) || h < 0 || a < 0) continue;
    const set: SetScore = { homeGames: h, awayGames: a };
    const ht = toNum(s.PlayerOneTiebreakScore);
    const at = toNum(s.PlayerTwoTiebreakScore);
    if (ht !== undefined) set.homeTiebreak = ht;
    if (at !== undefined) set.awayTiebreak = at;
    out.push(set);
  }
  return out;
}

function mapGame(g: z.infer<typeof zGame>, now: number): TennisMatch | null {
  const p1Name = coalesce(g.PlayerOne, g.Player1);
  const p2Name = coalesce(g.PlayerTwo, g.Player2);
  if (!p1Name || !p2Name) return null;
  const gameId = toNum(g.GameId);
  if (gameId === undefined) return null;

  const p1Id = toNum(coalesce(g.PlayerOneId, g.Player1Id));
  const p2Id = toNum(coalesce(g.PlayerTwoId, g.Player2Id));
  const tName = coalesce(g.CompetitionName, g.TournamentName);
  const providerSurface = toSurface(g.Surface);
  const resolvedSurface = providerSurface ?? resolveSurfaceFromTournament(tName);
  const surface = resolvedSurface ?? "hard";
  const day = coalesce(g.DateTime, g.Day);
  const season = toNum(g.Season) ?? seasonFromIso(day, new Date(now).getUTCFullYear());
  const state = toMatchState(g.Status) ?? "scheduled";
  const winner = (g.Winner ?? "").toLowerCase();

  const mkSide = (name: string, id: number | undefined, side: "home" | "away", isWin: boolean | undefined): MatchSide => ({
    playerId: id !== undefined ? `${NAME}:${id}` : `${NAME}:${side}:${gameId}`,
    playerName: name,
    side,
    isWinner: isWin,
  });

  const winnerKnown = winner === "playerone" || winner === "player1" || winner === "playertwo" || winner === "player2";
  const homeWin = winnerKnown ? winner === "playerone" || winner === "player1" : undefined;

  const sources = [NAME];
  if (!resolvedSurface) sources.push(SURFACE_UNRESOLVED);

  return {
    id: `${NAME}:${gameId}`,
    tournamentId: `${NAME}:${tName ?? "unknown"}`,
    season: Number.isFinite(season) ? season : new Date(now).getUTCFullYear(),
    surface,
    environment: "unknown",
    format: "best_of_3", // SportsDataIO Game does not expose best-of reliably
    round: toRound(coalesce(g.Round, g.RoundName)) ?? "r32",
    state,
    startTime: day,
    home: mkSide(p1Name, p1Id, "home", homeWin),
    away: mkSide(p2Name, p2Id, "away", homeWin === undefined ? undefined : !homeWin),
    sets: state === "completed" || state === "retired" ? setsFromGame(g.Sets) : [],
    stats: [],
    externalIds: { [NAME]: String(gameId) },
    sources,
  };
}

function mapArray(raw: unknown, now: number, keep: (m: TennisMatch) => boolean): ParsedResult<TennisMatch[]> {
  if (!Array.isArray(raw)) return parseFail("expected a JSON array of games");
  const out: TennisMatch[] = [];
  for (const row of raw) {
    const g = zGame.safeParse(row);
    if (!g.success) continue;
    const m = mapGame(g.data, now);
    if (m && keep(m)) out.push(m);
  }
  return parsed(out);
}

export const sportsDataIoAdapter: LiveAdapter = {
  name: NAME,
  baseUrl: BASE,
  apiKeyEnvVar: "SPORTSDATAIO_TENNIS_API_KEY",
  capabilities: { schedule: true, results: true, rankings: true, players: true, historical: false },
  note: "Commercial license. Ocp-Apim-Subscription-Key header auth (key kept out of the URL).",

  buildSchedule(key: string, q: ScheduleQuery): HttpRequest {
    return { url: `${BASE}/scores/json/GamesByDate/${q.dateIso}`, headers: { "Ocp-Apim-Subscription-Key": key } };
  },
  parseSchedule(raw: unknown, now: number): ParsedResult<TennisMatch[]> {
    return mapArray(raw, now, (m) => m.state !== "completed" && m.state !== "retired");
  },

  buildResults(key: string, q: HistoricalQuery): HttpRequest {
    return { url: `${BASE}/scores/json/Games/${q.season}`, headers: { "Ocp-Apim-Subscription-Key": key } };
  },
  parseResults(raw: unknown, now: number): ParsedResult<TennisMatch[]> {
    return mapArray(raw, now, (m) => m.state === "completed" || m.state === "retired" || m.state === "walkover");
  },

  buildPlayer(key: string, externalId: string): HttpRequest {
    // SportsDataIO exposes a full Players list; resolve the id client-side.
    void externalId;
    return { url: `${BASE}/scores/json/Players`, headers: { "Ocp-Apim-Subscription-Key": key } };
  },
  parsePlayer(raw: unknown, _now: number, externalId: string): ParsedResult<TennisPlayer | null> {
    void _now;
    if (!Array.isArray(raw)) return parseFail("expected a JSON array of players");
    const wanted = externalId.startsWith(`${NAME}:`) ? externalId.slice(NAME.length + 1) : externalId;
    for (const row of raw) {
      const p = zPlayer.safeParse(row);
      if (!p.success) continue;
      const pid = toNum(p.data.PlayerId);
      if (pid === undefined || String(pid) !== wanted) continue;
      const first = p.data.FirstName ?? "";
      const last = p.data.LastName ?? "";
      const full = (p.data.CommonName ?? `${first} ${last}`).trim();
      if (!full) return parseFail("player row lacked a usable name");
      const hand = (coalesce(p.data.Hand, p.data.PlayingHand) ?? "").toLowerCase();
      return parsed({
        id: `${NAME}:${pid}`,
        fullName: full,
        normalizedName: normalizeName(full),
        tour: "atp", // SportsDataIO player record does not state tour; resolved later
        countryCode: coalesce(p.data.Nationality, p.data.BirthCountry) || undefined,
        dateOfBirth: p.data.BirthDate ? p.data.BirthDate.slice(0, 10) : undefined,
        plays: hand.includes("left") ? "left" : hand.includes("right") ? "right" : "unknown",
        backhand: "unknown",
        heightCm: p.data.Height,
        externalIds: { [NAME]: String(pid) },
      });
    }
    return parsed(null); // no matching id ⇒ valid "not found", never a fabricated player
  },
};
