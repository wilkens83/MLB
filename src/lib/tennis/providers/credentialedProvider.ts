/* ============================================================================
   Credentialed live-provider factory. Real tennis data providers (Sportradar,
   SportsDataIO, API-Tennis) require a server-side API key. In THIS environment no
   such keys exist, so these providers are INERT BY DESIGN:

     - status() is "unconfigured" when the key env var is absent.
     - every data method returns an empty result and records a failure with a
       clear "no credentials" detail — it never throws, never fabricates data,
       and is never described as production-verified (audit §5 compliance).

   The factory captures each provider's real base URL, auth scheme, and the env
   var that would activate it, so wiring a real key later is a one-line change and
   the endpoints are documented in `docs/tennis/PROVIDERS.md`. Keys are read from
   `process.env` (server-side only) and are NEVER logged or returned to a client.
   ========================================================================== */

import type {
  HistoricalQuery, ProviderCapabilities, ProviderStatus, ScheduleQuery, TennisDataProvider,
} from "./types";
import type { RankingSnapshot, TennisMatch, TennisPlayer, TennisTour, Tournament } from "../domain";
import { recordFailure, setStatus } from "./health";

export interface CredentialedProviderSpec {
  name: string;
  /** Documentation base URL of the upstream API. */
  baseUrl: string;
  /** Env var that holds the server-side API key. Absent ⇒ provider inert. */
  apiKeyEnvVar: string;
  capabilities: ProviderCapabilities;
  /** Human note describing licensing / verification status. */
  note: string;
}

const UNCONFIGURED = "No API credentials configured — provider inert by design.";

/**
 * Build a provider that is fully interface-conformant but serves nothing until a
 * real key + verified upstream mapping exist. Returning empty (not throwing) lets
 * the registry fail over to the next provider cleanly.
 */
export function createCredentialedProvider(spec: CredentialedProviderSpec): TennisDataProvider {
  const hasKey = () => Boolean(process.env[spec.apiKeyEnvVar]);

  function statusNow(): ProviderStatus {
    // Even WITH a key, the upstream response mapping has not been verified against
    // the live API in this environment, so we do not claim "ready". We surface
    // "unconfigured" until a real integration test confirms the mapping. This
    // avoids ever describing an unverified provider as production-verified.
    const s: ProviderStatus = hasKey() ? "error" : "unconfigured";
    setStatus(spec.name, s, hasKey() ? "Key present; upstream mapping unverified in this environment." : UNCONFIGURED);
    return s;
  }

  function inert<T>(method: string, empty: T): T {
    recordFailure(spec.name, `${method}: ${hasKey() ? "unverified mapping" : "no credentials"}`);
    return empty;
  }

  return {
    name: spec.name,
    capabilities: spec.capabilities,
    status: statusNow,
    async getSchedule(_q: ScheduleQuery): Promise<TennisMatch[]> {
      void _q; return inert("getSchedule", []);
    },
    async getMatchResults(_q: HistoricalQuery): Promise<TennisMatch[]> {
      void _q; return inert("getMatchResults", []);
    },
    async getRankings(_tour: TennisTour): Promise<RankingSnapshot[]> {
      void _tour; return inert("getRankings", []);
    },
    async getPlayer(_id: string): Promise<TennisPlayer | null> {
      void _id; return inert("getPlayer", null);
    },
    async getTournaments(_season: number): Promise<Tournament[]> {
      void _season; return inert("getTournaments", []);
    },
  };
}
