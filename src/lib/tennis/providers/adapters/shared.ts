/* ============================================================================
   Shared contracts + helpers for the live provider adapters. Each provider owns
   its own raw Zod schemas and mappers (upstream shapes differ), but they all
   speak this `LiveAdapter` shape to the credentialed factory and reuse the
   generic domain-mapping helpers below.

   Mapping discipline (audit §5 / AGENTS.md): a field a provider does not supply
   stays `undefined` — NEVER coerced to 0/false. A response that does not validate
   is a `schema` failure, never silently mapped to `[]`.
   ========================================================================== */

import type {
  DrawRound, MatchFormat, MatchState, Surface, TennisTour,
} from "../../domain/enums";
import type {
  RankingSnapshot, SetScore, TennisMatch, TennisPlayer, Tournament,
} from "../../domain";
import type { HttpRequest } from "../http";
import type { ProviderCapabilities, ScheduleQuery, HistoricalQuery } from "../types";

/** Parsing outcome: a validated+mapped value, or a described schema failure. */
export type ParsedResult<T> =
  | { ok: true; value: T }
  | { ok: false; reason: string };

export const parsed = <T>(value: T): ParsedResult<T> => ({ ok: true, value });
export const parseFail = <T>(reason: string): ParsedResult<T> => ({ ok: false, reason });

/**
 * A live adapter: how to build each capability's request (with the key injected)
 * and how to validate+map its response into the canonical domain. Capabilities a
 * provider does not offer omit the pair, and the factory reports them unsupported.
 * `now` is the fetch time (epoch ms) for deterministic provenance in tests.
 */
export interface LiveAdapter {
  readonly name: string;
  readonly baseUrl: string;
  readonly apiKeyEnvVar: string;
  readonly capabilities: ProviderCapabilities;
  readonly note: string;

  buildSchedule?(key: string, q: ScheduleQuery): HttpRequest;
  parseSchedule?(raw: unknown, now: number): ParsedResult<TennisMatch[]>;

  buildResults?(key: string, q: HistoricalQuery): HttpRequest;
  parseResults?(raw: unknown, now: number): ParsedResult<TennisMatch[]>;

  buildRankings?(key: string, tour: TennisTour, asOf?: string): HttpRequest;
  parseRankings?(raw: unknown, now: number): ParsedResult<RankingSnapshot[]>;

  buildPlayer?(key: string, externalId: string): HttpRequest;
  parsePlayer?(raw: unknown, now: number, externalId: string): ParsedResult<TennisPlayer | null>;

  buildTournaments?(key: string, season: number, tour?: TennisTour): HttpRequest;
  parseTournaments?(raw: unknown, now: number): ParsedResult<Tournament[]>;
}

// --- Generic domain-mapping helpers (provider-agnostic) --------------------

/** Normalize a free-text surface label to the domain enum, or undefined. */
export function toSurface(raw: string | undefined | null): Surface | undefined {
  if (!raw) return undefined;
  const s = raw.toLowerCase();
  if (s.includes("clay")) return "clay";
  if (s.includes("grass")) return "grass";
  if (s.includes("carpet")) return "carpet";
  if (s.includes("hard")) return "hard";
  return undefined;
}

/** Best-of format from a numeric or string hint; undefined when unknown. */
export function toFormat(bestOf: number | string | undefined | null): MatchFormat | undefined {
  const n = typeof bestOf === "string" ? Number(bestOf) : bestOf;
  if (n === 5) return "best_of_5";
  if (n === 3) return "best_of_3";
  return undefined;
}

/** Normalize a round label (e.g. "R32", "Final", "Quarter-finals") to the enum. */
export function toRound(raw: string | undefined | null): DrawRound | undefined {
  if (!raw) return undefined;
  const s = raw.toLowerCase().replace(/[\s_-]/g, "");
  if (s.includes("qual")) return "qualifying";
  if (s === "f" || s.includes("final") && !s.includes("semi") && !s.includes("quarter")) return "final";
  if (s.includes("semi") || s === "sf") return "semifinal";
  if (s.includes("quarter") || s === "qf") return "quarterfinal";
  if (s === "r16" || s.includes("round16") || s.includes("last16")) return "r16";
  if (s === "r32" || s.includes("round32")) return "r32";
  if (s === "r64" || s.includes("round64")) return "r64";
  if (s === "r128" || s.includes("round128")) return "r128";
  return undefined;
}

/**
 * Parse a tennis score string ("6-4 3-6 7-6(4)") into ordered SetScores from the
 * home player's perspective. Tiebreak points in parentheses attach to the LOSER
 * of that set (standard notation shows the loser's TB points). Returns [] for an
 * unparseable/empty string so the caller can decide (scheduled matches have none).
 */
export function parseScoreString(score: string | undefined | null): SetScore[] {
  if (!score || typeof score !== "string") return [];
  const sets: SetScore[] = [];
  for (const token of score.trim().split(/\s+/)) {
    const m = token.match(/^(\d+)-(\d+)(?:\((\d+)\))?$/);
    if (!m) return []; // any malformed set → treat whole string as unparseable
    const home = Number(m[1]);
    const away = Number(m[2]);
    const tb = m[3] !== undefined ? Number(m[3]) : undefined;
    const set: SetScore = { homeGames: home, awayGames: away };
    if (tb !== undefined) {
      // Loser's TB points shown; attach to whichever side lost the set.
      if (home > away) set.awayTiebreak = tb;
      else set.homeTiebreak = tb;
    }
    sets.push(set);
  }
  return sets;
}

/** Map a provider status label to the domain match state; undefined when unknown. */
export function toMatchState(raw: string | undefined | null): MatchState | undefined {
  if (!raw) return undefined;
  const s = raw.toLowerCase();
  if (["finished", "closed", "ended", "complete", "completed", "final"].some((k) => s.includes(k))) return "completed";
  if (s.includes("retired") || s.includes("ret.")) return "retired";
  if (s.includes("walkover") || s.includes("w/o") || s.includes("walk over")) return "walkover";
  if (["cancelled", "canceled", "abandoned"].some((k) => s.includes(k))) return "cancelled";
  // Check "not started"/scheduled BEFORE live: "not started" contains "started".
  if (["not started", "notstarted", "scheduled", "pending", "upcoming"].some((k) => s.includes(k))) return "scheduled";
  if (["live", "inprogress", "in progress", "playing"].some((k) => s.includes(k))) return "live";
  return undefined;
}

/** ISO date (YYYY-MM-DD) → season year. */
export function seasonFromIso(iso: string | undefined, fallback: number): number {
  if (!iso) return fallback;
  const y = Number(iso.slice(0, 4));
  return Number.isFinite(y) && y > 1900 ? y : fallback;
}

/**
 * Factual surface lookup for well-known events. Surface is a property of the
 * tournament/venue (a real-world fact, not invented), so resolving "Wimbledon" →
 * grass is a lookup, not fabrication. Returns undefined for anything not in the
 * table — the caller then records `SURFACE_UNRESOLVED` provenance rather than
 * silently claiming a surface it does not know.
 */
export function resolveSurfaceFromTournament(name: string | undefined | null): Surface | undefined {
  if (!name) return undefined;
  const n = name.toLowerCase();
  if (n.includes("wimbledon")) return "grass";
  if (n.includes("roland garros") || n.includes("french open")) return "clay";
  if (n.includes("us open") || n.includes("australian open")) return "hard";
  // Clay swing majors / 1000s.
  if (["monte carlo", "monte-carlo", "madrid open", "rome", "italian open", "hamburg", "estoril", "munich", "barcelona"].some((k) => n.includes(k))) return "clay";
  // Grass swing.
  if (["halle", "queen", "'s-hertogenbosch", "hertogenbosch", "eastbourne", "stuttgart open", "mallorca", "newport"].some((k) => n.includes(k))) return "grass";
  return undefined;
}

/** Sentinel appended to a match's `sources` when surface was defaulted, not provider-confirmed. */
export const SURFACE_UNRESOLVED = "surface:unresolved";

