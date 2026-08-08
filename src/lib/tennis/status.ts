/* ============================================================================
   Server-side tennis data-availability status. The single honest source the UI
   consults. It reports EVERY data path — free historical, manual entry, demo
   fixtures, and the (unconfigured) paid live providers — with the active data
   MODE, and NEVER fabricates: it shows LIVE only when a credentialed provider was
   verified live (audit §5 / compliance invariants). With no paid keys the Tennis
   section is still fully usable via the free historical + manual + demo paths.

   Server-only — the credentialed providers read API keys from `process.env`,
   which must never reach the client.
   ========================================================================== */

import {
  sportradarProvider, sportsDataIoProvider, apiTennisProvider,
} from "./providers/liveProviders";
import { getAllTennisHealth, getTennisHealth } from "./providers/health";
import { fixtureProvider } from "./providers/fixtureProvider";
import type { CapabilityStatus, ProviderStatus, TennisProviderHealth } from "./providers/types";
import { getFreeDataset, createHistoricalFreeProvider, type FreeDatasetCoverage } from "./data/freeDataset";
import type { DatasetManifest } from "./data/datasets/manifest";
import { describeDataMode, type DataModeSummary, type TennisDataMode } from "./data/mode";

export interface TennisProviderStatusRow {
  name: string;
  status: ProviderStatus;
  detail?: string;
  /** Which data mode this provider serves (for the health surface). */
  mode: TennisDataMode | "PAID_LIVE";
  /** Capabilities the provider declares (for the health surface). */
  capabilities: string[];
  capabilityStatus?: Partial<Record<string, CapabilityStatus>>;
  configured: boolean;
  lastVerifiedAt?: number;
  avgResponseMs?: number;
}

export interface TennisDataStatus {
  /** True when at least one paid provider was VERIFIED live. */
  liveConfigured: boolean;
  /** True when the free historical corpus is loaded. */
  historicalConfigured: boolean;
  /** Active data-mode summary (LIVE / HISTORICAL / MANUAL / FIXTURE …). */
  dataMode: DataModeSummary;
  providers: TennisProviderStatusRow[];
  /** Free-dataset provenance + coverage (for the license/health UI). */
  freeDataset: { manifest: DatasetManifest; coverage: FreeDatasetCoverage };
  generatedAt: number;
}

export function getTennisDataStatus(): TennisDataStatus {
  const ds = getFreeDataset();
  const freeProvider = createHistoricalFreeProvider(ds);
  const live = [sportradarProvider, sportsDataIoProvider, apiTennisProvider];

  const freeStatus = freeProvider.status();
  const fixtureStatus = fixtureProvider.status();

  const rows: TennisProviderStatusRow[] = [];

  // 1) Free historical — the primary no-cost analytics path.
  rows.push({
    name: "historical-free",
    status: freeStatus,
    detail: getTennisHealth("historical-free")?.detail
      ?? `Free historical dataset (${ds.manifest.datasetVersion})`,
    mode: "HISTORICAL",
    capabilities: Object.entries(freeProvider.capabilities).filter(([, v]) => v).map(([k]) => k),
    capabilityStatus: freeProvider.capabilityStatus?.(),
    configured: freeStatus === "ready",
  });

  // 2) Manual current-match entry — a capability that is always available to use.
  rows.push({
    name: "manual",
    status: "ready",
    detail: "Enter today's matchup by hand; combined with free historical stats.",
    mode: "MANUAL",
    capabilities: ["schedule", "players"],
    configured: true,
  });

  // 3) Demo fixtures — deterministic UI demo (clearly DEMO, never live).
  rows.push({
    name: "demo-fixture",
    status: fixtureStatus,
    detail: "Deterministic demo data for exercising the full UI. DEMO DATA — never live.",
    mode: "FIXTURE",
    capabilities: ["schedule", "results", "rankings", "players", "historical"],
    configured: fixtureStatus === "fixture",
  });

  // 4) Paid live providers — real status (unconfigured until keyed + verified).
  for (const p of live) {
    const status = p.status();
    const h = getTennisHealth(p.name);
    rows.push({
      name: p.name,
      status,
      detail: h?.detail,
      mode: "PAID_LIVE",
      capabilities: Object.entries(p.capabilities).filter(([, v]) => v).map(([k]) => k),
      capabilityStatus: p.capabilityStatus?.(),
      configured: status === "ready",
      lastVerifiedAt: h?.lastVerifiedAt,
      avgResponseMs: h?.avgResponseMs,
    });
  }

  const liveConfigured = live.some((p) => p.status() === "ready");
  const dataMode = describeDataMode({
    live: liveConfigured,
    freeCurrent: false, // no permitted no-cost CURRENT source wired
    historical: freeStatus === "ready",
    manual: true,
    fixture: fixtureStatus === "fixture",
  });

  return {
    liveConfigured,
    historicalConfigured: freeStatus === "ready",
    dataMode,
    providers: rows,
    freeDataset: { manifest: ds.manifest, coverage: ds.coverage },
    generatedAt: Date.now(),
  };
}

/** Convenience: the health-registry rows (name/status/counters) for the UI. */
export function tennisHealthRows(): TennisProviderHealth[] {
  getTennisDataStatus();
  return getAllTennisHealth();
}
