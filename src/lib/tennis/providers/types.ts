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

/**
 * Provider readiness. This is a truthful lifecycle, NOT a binary — a key existing
 * in `process.env` is never enough for `ready`. A provider only reaches `ready`
 * after a live call has authenticated, validated its schema, mapped to the
 * canonical domain, and passed independent verification (see
 * `credentialedProvider.ts`).
 *
 * Legacy members (`ready`/`unconfigured`/`fixture`/`error`) are preserved so the
 * registry, health surface, and existing tests keep working; the additive members
 * expose finer real states.
 */
export type ProviderStatus =
  | "ready" // verified: credential + auth + a live call that validated + mapped + passed verification
  | "configured_unverified" // key present, but no verified live call has succeeded yet
  | "authenticating" // a live call is in flight
  | "degraded" // partially working (some capability failing) but still usable
  | "rate_limited" // hit an upstream quota / Retry-After; backing off
  | "entitlement_missing" // key valid but the account tier does not permit this data
  | "unconfigured" // needs credentials that are absent — inert by design
  | "fixture" // serves labeled test fixtures only, never production
  | "disabled" // explicitly turned off by config
  | "error"; // configured but failing

/** States in which the registry may route a live request to the provider. */
export const ROUTABLE_STATUSES: readonly ProviderStatus[] = [
  "ready",
  "configured_unverified", // allowed to ATTEMPT so it can earn `ready` via a verified call
  "degraded",
];

/** Per-capability runtime availability, distinct from adapter support. */
export type CapabilityStatus =
  | "verified" // exercised live and mapped successfully
  | "supported" // adapter implements it; not yet live-verified
  | "entitlement_missing" // account tier does not permit it
  | "unsupported"; // upstream/adapter does not offer it

export interface TennisProviderHealth {
  name: string;
  status: ProviderStatus;
  lastSuccessAt?: number;
  lastFailureAt?: number;
  /** Last time a live call authenticated + validated + mapped + verified. */
  lastVerifiedAt?: number;
  failures: number;
  requests: number;
  avgResponseMs: number;
  /** Most recent upstream rate-limit signal, when seen. */
  rateLimit?: RateLimitState;
  detail?: string;
}

/** Upstream rate-limit metadata, parsed from response headers when present. */
export interface RateLimitState {
  /** Seconds to wait before retrying, from a `Retry-After` header. */
  retryAfterSec?: number;
  /** Remaining request quota in the current window, when advertised. */
  remaining?: number;
  /** Epoch ms when the quota window resets, when advertised. */
  resetAt?: number;
}

/**
 * Provenance stamped on every record a live provider emits, so a downstream
 * consumer can audit where a fact came from and when it was knowable. Never
 * contains secrets.
 */
export interface ProviderProvenance {
  /** Provider that produced the record. */
  provider: string;
  /** Provider's own id for the upstream entity. */
  providerRecordId?: string;
  /** When the provider says the fact became effective (event/publication time). */
  sourceTimestamp?: string;
  /** When we fetched it (epoch ms). */
  capturedAt: number;
  /** Freshness horizon the consumer should treat the data as valid for (epoch ms). */
  dataAsOf: number;
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
  /**
   * Optional: per-capability runtime availability for the health surface. When a
   * provider does not implement this the UI falls back to the boolean
   * `capabilities` map. `verified` is only reported after a live call succeeded.
   */
  capabilityStatus?(): Partial<Record<keyof ProviderCapabilities, CapabilityStatus>>;

  getSchedule(query: ScheduleQuery): Promise<TennisMatch[]>;
  getMatchResults(query: HistoricalQuery): Promise<TennisMatch[]>;
  getRankings(tour: TennisTour, asOf?: string): Promise<RankingSnapshot[]>;
  getPlayer(externalId: string): Promise<TennisPlayer | null>;
  getTournaments(season: number, tour?: TennisTour): Promise<Tournament[]>;
}
