/* ============================================================================
   Normalized tennis domain models. The tennis analytics engine consumes ONLY
   these types — never a provider's raw API shape. Providers map their upstream
   responses into these entities (mirroring the MLB `src/lib/domain/models.ts`
   discipline).

   Availability rule (audit §5): a metric a source does not provide stays
   `undefined` and MUST be surfaced as "unavailable" — never defaulted to a
   number. Nothing here is fabricated.
   ========================================================================== */

import type {
  TennisTour, Surface, Environment, MatchFormat, Plays, Backhand,
  TournamentLevel, MatchState, DrawRound,
} from "./enums";

/**
 * A canonical Diamond Edge player identity. `id` is our own stable id; provider
 * ids are held in `externalIds` so the same human is one entity across sources.
 * Identity resolution (Phase 5) populates `externalIds` — we NEVER join by name
 * alone.
 */
export interface TennisPlayer {
  /** Diamond Edge canonical id (stable, provider-independent). */
  id: string;
  fullName: string;
  /** Normalized "last, first" or slug for matching; set by identity resolution. */
  normalizedName: string;
  tour: TennisTour;
  countryCode?: string; // ISO-3166 alpha-3 when known
  dateOfBirth?: string; // ISO date; a strong disambiguation key
  plays: Plays;
  backhand: Backhand;
  heightCm?: number;
  turnedProYear?: number;
  /** Crosswalk of provider name → that provider's player id. */
  externalIds: Record<string, string>;
}

/** A point-in-time ranking observation. Rankings are time-series, never a scalar. */
export interface RankingSnapshot {
  playerId: string;
  tour: TennisTour;
  /** ISO date the ranking was published/effective. */
  asOf: string;
  rank: number;
  points?: number;
  /** Race (season) rank when distinct from the rolling ranking. */
  raceRank?: number;
}

export interface Tournament {
  id: string;
  name: string;
  tour: TennisTour;
  level: TournamentLevel;
  surface: Surface;
  environment: Environment;
  /** Host city/country for context + travel/altitude considerations later. */
  city?: string;
  countryCode?: string;
  /** Altitude in metres when known (affects ball flight / serve). */
  altitudeM?: number;
  startDate?: string; // ISO
  endDate?: string; // ISO
  season: number;
  externalIds: Record<string, string>;
}

/**
 * A single completed set's game score, from the winner's perspective is NOT
 * assumed — `home`/`away` mirror the match's two sides so tiebreaks and set
 * ownership are unambiguous.
 */
export interface SetScore {
  homeGames: number;
  awayGames: number;
  /** Tiebreak points if the set went to a breaker; undefined otherwise. */
  homeTiebreak?: number;
  awayTiebreak?: number;
}

/** Per-player serve/return/statistical line for one match. All optional. */
export interface MatchStatLine {
  playerId: string;
  aces?: number;
  doubleFaults?: number;
  firstServePct?: number; // 0..1
  firstServeWonPct?: number; // 0..1
  secondServeWonPct?: number; // 0..1
  breakPointsFaced?: number;
  breakPointsSaved?: number;
  breakPointsConverted?: number;
  serviceGamesPlayed?: number;
  serviceGamesWon?: number;
  returnGamesPlayed?: number;
  returnGamesWon?: number;
  totalPointsWon?: number;
  /** Which named metrics were actually present in the source (availability). */
  availableMetrics: string[];
}

/** The two sides of a match. `side` disambiguates home/away in set scores. */
export interface MatchSide {
  playerId: string;
  playerName: string;
  side: "home" | "away";
  seed?: number;
  /** Ranking at match time when known. */
  rankAtMatch?: number;
  isWinner?: boolean;
}

/**
 * A match — the atomic unit of tennis. Used for both historical corpus rows and
 * upcoming fixtures. `state` distinguishes a scheduled fixture (no result) from a
 * completed row (has `sets`, `stats`).
 */
export interface TennisMatch {
  id: string;
  tournamentId: string;
  tournament?: Tournament; // hydrated when available
  season: number;
  surface: Surface;
  environment: Environment;
  format: MatchFormat;
  round: DrawRound;
  state: MatchState;
  /** ISO datetime of scheduled/actual start. */
  startTime?: string;
  home: MatchSide;
  away: MatchSide;
  /** Completed sets in order; empty for a scheduled fixture. */
  sets: SetScore[];
  /** Per-player stat lines; empty/partial when unavailable. */
  stats: MatchStatLine[];
  externalIds: Record<string, string>;
  /** Source provider(s) this record was assembled from, for provenance. */
  sources: string[];
}

/**
 * One row of a player's match-level series for a given derived metric, ordered
 * oldest→newest by the caller. Mirrors MLB's `GameLogEntry` so the shared
 * hit-rate analytics (`analyzeStat`) can consume tennis series unchanged.
 */
export interface TennisMatchSample {
  matchId: string;
  date?: string;
  opponentId?: string;
  opponentName?: string;
  surface: Surface;
  /** The single numeric value of the derived metric for this match. */
  value: number;
  /** Raw derived fields relevant to markets (aces, games won, etc.). */
  stat: Record<string, number>;
}

/**
 * Serve/return rate parameters that drive the structural match simulation
 * (Phase 6). These are the tennis analogue of a projection's `lambda`: the model
 * inputs, estimated from history + surface + Elo, that the point-level Monte
 * Carlo consumes. Populated by the projection layer, not by providers.
 */
export interface ServeReturnRates {
  playerId: string;
  /** P(win a point on own serve) on the match surface. */
  servePointWinProb: number;
  /** P(win a point on return) — typically 1 - opponent's serve dominance. */
  returnPointWinProb: number;
  /** Ace rate per service point, when modeled. */
  aceProb?: number;
  /** Double-fault rate per service point, when modeled. */
  doubleFaultProb?: number;
  /** Effective sample size behind the estimate. */
  sampleSize: number;
}

/** Data-availability descriptor attached to any tennis metric we surface. */
export interface TennisAvailability {
  available: boolean;
  reason?: string;
  source?: string;
  fetchedAt?: number;
}
