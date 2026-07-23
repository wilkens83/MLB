/* ============================================================================
   Server-side tennis data-availability status. This is the single honest source
   the UI consults to decide whether to render live data or a degraded/empty
   state. It NEVER fabricates: with no credentials configured every live provider
   reports "unconfigured", and the UI surfaces exactly that.

   Server-only — the credentialed providers read API keys from `process.env`,
   which must never reach the client (audit §5 / compliance invariants).
   ========================================================================== */

import {
  sportradarProvider, sportsDataIoProvider, apiTennisProvider,
} from "./providers/liveProviders";
import { getAllTennisHealth } from "./providers/health";
import type { ProviderStatus, TennisProviderHealth } from "./providers/types";

export interface TennisProviderStatusRow {
  name: string;
  status: ProviderStatus;
  detail?: string;
  /** Capabilities the provider declares (for the health surface). */
  capabilities: string[];
  configured: boolean;
}

export interface TennisDataStatus {
  /** True when at least one provider can serve live/production data. */
  liveConfigured: boolean;
  /** True when historical corpus / manual data is loaded (backtesting-only). */
  historicalConfigured: boolean;
  providers: TennisProviderStatusRow[];
  generatedAt: number;
}

/**
 * Snapshot the readiness of every tennis data source. Calling `status()` on each
 * provider refreshes the health registry and reflects real env-var presence.
 */
export function getTennisDataStatus(): TennisDataStatus {
  const live = [sportradarProvider, sportsDataIoProvider, apiTennisProvider];

  const providers: TennisProviderStatusRow[] = live.map((p) => {
    const status = p.status(); // refreshes health + reflects credentials
    return {
      name: p.name,
      status,
      capabilities: Object.entries(p.capabilities)
        .filter(([, v]) => v)
        .map(([k]) => k),
      configured: status === "ready",
    };
  });

  return {
    liveConfigured: providers.some((p) => p.status === "ready"),
    // No historical corpus is bundled in this environment; imports target a
    // swappable store the operator populates. Reported honestly as absent.
    historicalConfigured: false,
    providers,
    generatedAt: Date.now(),
  };
}

/** Convenience: the health-registry rows (name/status/counters) for the UI. */
export function tennisHealthRows(): TennisProviderHealth[] {
  // Ensure status() has run so rows reflect current readiness.
  getTennisDataStatus();
  return getAllTennisHealth();
}
