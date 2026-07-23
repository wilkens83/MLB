/* ============================================================================
   Tennis data-provider abstraction. The acquisition layer depends on these
   interfaces, never on a concrete source — so a provider can be swapped,
   failed-over, or mocked without touching the engine. Each provider maps its
   upstream responses into the normalized domain models in `../domain`.

   IMPORTANT (audit §5 compliance): no adapter here performs account automation,
   login, credential storage, or anti-bot bypass. Providers that require API keys
   are INERT without server-side credentials and must never be described as
   "production-verified" until real credentials have exercised them. Fixture-backed
   providers are labeled test-only and never used in a production data path.
   ========================================================================== */

import type {
  TennisPlayer, TennisMatch, RankingSnapshot, Tournament, TennisTour,
} from "../domain";

/** Capabilities a provider declares so the registry can route requests. */
export interface ProviderCapabilities {
  /** Upcoming fixtures / schedule. */
  schedule: boolean;
  /** Completed match results + stats. */
  results: boolean;
  /** Rankings time-series. */
  rankings: boolean;
  /** Player biographical profiles. */
  players: boolean;
  /** Bulk historical corpus (for backtesting). */
  historical: boolean;
}

/** Whether a provider is ready to serve real data. */
export type ProviderStatus =
  | "ready" // credentials present (or none needed) and reachable
  | "unconfigured" // needs credentials that are absent — inert by design
  | "fixture" // serves labeled test fixtures only, never production
  | "error"; // configured but failing

export interface TennisProviderHealth {
  name: string;
  status: ProviderStatus;
  lastSuccessAt?: number;
  lastFailureAt?: number;
  failures: number;
  requests: number;
  avgResponseMs: number;
  detail?: string;
}

export interface ScheduleQuery {
  dateIso: string;
  tour?: TennisTour;
}

export interface HistoricalQuery {
  tour: TennisTour;
  season: number;
  surface?: string;
}

/**
 * The provider contract. Every method returns normalized domain models. A
 * provider that cannot answer a capability returns an empty result and reflects
 * that in its capabilities — it never throws to signal "not supported".
 */
export interface TennisDataProvider {
  readonly name: string;
  readonly capabilities: ProviderCapabilities;
  /** Current readiness — drives registry failover and the health surface. */
  status(): ProviderStatus;

  getSchedule(query: ScheduleQuery): Promise<TennisMatch[]>;
  getMatchResults(query: HistoricalQuery): Promise<TennisMatch[]>;
  getRankings(tour: TennisTour, asOf?: string): Promise<RankingSnapshot[]>;
  getPlayer(externalId: string): Promise<TennisPlayer | null>;
  getTournaments(season: number, tour?: TennisTour): Promise<Tournament[]>;
}
