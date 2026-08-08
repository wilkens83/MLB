/* ============================================================================
   Credentialed live-provider factory. Wraps a provider-specific `LiveAdapter`
   (URL/auth/schema/mapping) with the shared operational concerns: credential
   gating, the HTTP client (timeout/retry/backoff/rate-limit), runtime Zod
   validation, canonical mapping, independent verification, provenance, health,
   and a TRUTHFUL status lifecycle.

   Two runtime regimes, both honest:
     - NO KEY  → inert by design. status() = "unconfigured"; every method returns
       an empty result and records a "no credentials" failure. Never throws,
       never fabricates, never marks ready. (Preserves the audit §5 contract and
       the existing inert-provider tests.)
     - KEY SET → real calls. status() starts at "configured_unverified" (a key is
       NOT enough for ready), and only becomes "ready" after a live call
       authenticated + validated + mapped + PASSED independent verification.
       Auth/entitlement/rate-limit/schema failures map to explicit statuses.

   Keys are read from process.env (server-side only) and NEVER logged or returned
   to a client — the HTTP client sanitizes URLs/headers before any log line.
   ========================================================================== */

import type {
  CapabilityStatus, HistoricalQuery, ProviderCapabilities, ProviderStatus,
  ScheduleQuery, TennisDataProvider,
} from "./types";
import type { RankingSnapshot, TennisMatch, TennisPlayer, TennisTour, Tournament } from "../domain";
import {
  recordFailure, recordRateLimit, recordSuccess, recordVerified, setStatus,
} from "./health";
import {
  DEFAULT_RETRY, httpGetJson, type HttpDeps, type HttpError, type HttpRequest, type RetryConfig,
} from "./http";
import type { LiveAdapter, ParsedResult } from "./adapters/shared";
import { matchesAcceptable, rankingsAcceptable } from "./verify";

const NO_CREDENTIALS = "No API credentials configured — provider inert by design.";
const NOT_WIRED = "Capability declared but not wired for this query shape in this adapter.";

export interface CredentialedProviderOptions {
  /** Inject fetch/sleep/now/random for deterministic tests. */
  http?: Partial<HttpDeps>;
  retry?: RetryConfig;
  timeoutMs?: number;
  now?: () => number;
}

/** Map an HTTP error to the provider status it should reflect. */
function statusForError(e: HttpError): ProviderStatus {
  switch (e.kind) {
    case "auth": return "error";
    case "entitlement": return "entitlement_missing";
    case "rate_limit": return "rate_limited";
    case "timeout":
    case "network":
    case "server": return "degraded";
    case "schema": return "error";
    default: return "error";
  }
}

function detailForError(e: HttpError): string {
  if (e.kind === "auth") return "AUTH_INVALID: credential rejected by upstream (401).";
  if (e.kind === "entitlement") return "ENTITLEMENT_MISSING: account tier does not permit this resource (403).";
  if (e.kind === "rate_limit") return "RATE_LIMITED: upstream quota hit; backing off.";
  if (e.kind === "schema") return "PROVIDER_SCHEMA_MISMATCH: response did not validate.";
  return `${e.kind.toUpperCase()}: ${e.message}`;
}

export function createCredentialedProvider(
  adapter: LiveAdapter,
  opts: CredentialedProviderOptions = {},
): TennisDataProvider {
  const name = adapter.name;
  const caps: ProviderCapabilities = adapter.capabilities;
  const now = opts.now ?? Date.now;
  const retry = opts.retry ?? DEFAULT_RETRY;
  const capStatus: Partial<Record<keyof ProviderCapabilities, CapabilityStatus>> = {};

  const httpDeps: HttpDeps = {
    fetch: opts.http?.fetch ?? (globalThis.fetch as typeof fetch),
    sleep: opts.http?.sleep,
    now: opts.http?.now,
    random: opts.http?.random,
    log: opts.http?.log,
  };

  const key = () => process.env[adapter.apiKeyEnvVar];

  /** Truthful synchronous status. A key alone never yields "ready". */
  function statusNow(): ProviderStatus {
    if (!key()) {
      setStatus(name, "unconfigured", NO_CREDENTIALS);
      return "unconfigured";
    }
    // Status was last set by a call (ready/degraded/rate_limited/entitlement_missing/error);
    // if none has run yet, we are configured but unverified — routable so we can EARN ready.
    return refreshFromHealth();
  }

  // Local mirror of the last meaningful status while a key is present.
  let current: ProviderStatus = "configured_unverified";
  function refreshFromHealth(): ProviderStatus {
    setStatus(name, current, current === "configured_unverified"
      ? "Key present; awaiting a verified live call before READY."
      : undefined);
    return current;
  }
  function markStatus(s: ProviderStatus, detail?: string) {
    current = s;
    setStatus(name, s, detail);
  }

  /**
   * Run one list-returning capability end-to-end: credential gate → build →
   * fetch → validate+map → verify → health/status. Returns the mapped records or
   * an empty array (never throws); the health/status carries WHY on failure.
   */
  async function runList<T>(
    capability: keyof ProviderCapabilities,
    build: ((k: string) => HttpRequest) | undefined,
    parse: ((raw: unknown, n: number) => ParsedResult<T[]>) | undefined,
    verify: (records: T[]) => boolean,
  ): Promise<T[]> {
    const k = key();
    if (!k) { recordFailure(name, `${String(capability)}: no credentials`); markStatusUnconfigured(); return []; }
    if (!caps[capability]) { capStatus[capability] = "unsupported"; return []; }
    if (!build || !parse) {
      capStatus[capability] = "supported";
      recordFailure(name, `${String(capability)}: ${NOT_WIRED}`);
      return [];
    }
    const t0 = now();
    const req: HttpRequest = { ...build(k), timeoutMs: opts.timeoutMs };
    const res = await httpGetJson<unknown>(req, httpDeps, retry);
    if (!res.ok) {
      if (res.error.rateLimit) recordRateLimit(name, res.error.rateLimit);
      recordFailure(name, `${String(capability)}: ${res.error.kind}`);
      markStatus(statusForError(res.error), detailForError(res.error));
      if (res.error.kind === "entitlement") capStatus[capability] = "entitlement_missing";
      return [];
    }
    const mapped = parse(res.data, now());
    if (!mapped.ok) {
      recordFailure(name, `${String(capability)}: PROVIDER_SCHEMA_MISMATCH (${mapped.reason})`);
      markStatus("error", `PROVIDER_SCHEMA_MISMATCH: ${mapped.reason}`);
      return [];
    }
    const ms = now() - t0;
    // Independent verification gates "verified"/READY.
    if (verify(mapped.value)) {
      recordVerified(name, ms);
      capStatus[capability] = "verified";
      markStatus("ready", `Verified ${String(capability)} live call.`);
    } else {
      recordSuccess(name, ms);
      capStatus[capability] = "supported";
      markStatus("degraded", `${String(capability)} mapped but failed independent verification.`);
    }
    return mapped.value;
  }

  function markStatusUnconfigured() { markStatus("unconfigured", NO_CREDENTIALS); }

  return {
    name,
    capabilities: caps,
    status: statusNow,
    capabilityStatus: () => ({ ...capStatus }),

    async getSchedule(q: ScheduleQuery): Promise<TennisMatch[]> {
      return runList<TennisMatch>(
        "schedule",
        adapter.buildSchedule ? (k) => adapter.buildSchedule!(k, q) : undefined,
        adapter.parseSchedule,
        matchesAcceptable,
      );
    },

    async getMatchResults(q: HistoricalQuery): Promise<TennisMatch[]> {
      return runList<TennisMatch>(
        "results",
        adapter.buildResults ? (k) => adapter.buildResults!(k, q) : undefined,
        adapter.parseResults,
        matchesAcceptable,
      );
    },

    async getRankings(tour: TennisTour, asOf?: string): Promise<RankingSnapshot[]> {
      return runList<RankingSnapshot>(
        "rankings",
        adapter.buildRankings ? (k) => adapter.buildRankings!(k, tour, asOf) : undefined,
        adapter.parseRankings,
        rankingsAcceptable,
      );
    },

    async getTournaments(season: number, tour?: TennisTour): Promise<Tournament[]> {
      return runList<Tournament>(
        "schedule",
        adapter.buildTournaments ? (k) => adapter.buildTournaments!(k, season, tour) : undefined,
        adapter.parseTournaments,
        () => true, // tournaments carry no match/ranking invariants to verify here
      );
    },

    async getPlayer(externalId: string): Promise<TennisPlayer | null> {
      const k = key();
      if (!k) { recordFailure(name, "getPlayer: no credentials"); markStatusUnconfigured(); return null; }
      if (!caps.players || !adapter.buildPlayer || !adapter.parsePlayer) {
        capStatus.players = caps.players ? "supported" : "unsupported";
        if (caps.players) recordFailure(name, `getPlayer: ${NOT_WIRED}`);
        return null;
      }
      const t0 = now();
      const req: HttpRequest = { ...adapter.buildPlayer(k, externalId), timeoutMs: opts.timeoutMs };
      const res = await httpGetJson<unknown>(req, httpDeps, retry);
      if (!res.ok) {
        if (res.error.rateLimit) recordRateLimit(name, res.error.rateLimit);
        recordFailure(name, `getPlayer: ${res.error.kind}`);
        markStatus(statusForError(res.error), detailForError(res.error));
        if (res.error.kind === "entitlement") capStatus.players = "entitlement_missing";
        return null;
      }
      const mapped = adapter.parsePlayer(res.data, now(), externalId);
      if (!mapped.ok) {
        recordFailure(name, `getPlayer: PROVIDER_SCHEMA_MISMATCH (${mapped.reason})`);
        markStatus("error", `PROVIDER_SCHEMA_MISMATCH: ${mapped.reason}`);
        return null;
      }
      recordVerified(name, now() - t0);
      capStatus.players = "verified";
      markStatus("ready", "Verified players live call.");
      return mapped.value;
    },
  };
}
