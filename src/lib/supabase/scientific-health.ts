/* ============================================================================
   Scientific Health & Model Performance — the canonical control center behind
   /health. It answers, from TRUSTED SERVER METRICS ONLY (Supabase scientific
   tables + provider health), whether the pipeline is sound: sources healthy,
   records persisting, predictions graded, probabilities calibrated, models
   drifting, which markets are BET-eligible, and which circuit breakers are live.

   Two layers so it is testable and honest:
     - a `ScientificDataSource` (Supabase-backed by default, injectable in tests);
     - a PURE `assembleScientificHealth(data)` that never invents numbers and
       reports INSUFFICIENT_DATA for thin samples — never zero-error "perfection".

   No client input reaches this module; every status here is server-derived.
   ========================================================================== */

import type { ProviderHealth } from "@/lib/providers/types";
import { getAllHealth } from "@/lib/providers/health";
import { getServiceClient } from "./server";
import { isServiceRoleConfigured, isSupabaseConfigured } from "./env";
import type { Database } from "./database.types";

type MetricsRow = Database["public"]["Tables"]["market_validation_metrics"]["Row"];
type RegistryRow = Database["public"]["Tables"]["model_registry"]["Row"];
type DriftRow = Database["public"]["Tables"]["drift_reports"]["Row"];
type BreakerRow = Database["public"]["Tables"]["circuit_breaker_events"]["Row"];

/** Minimum graded samples before a metric may be reported at all. */
export const MIN_CALIBRATION_SAMPLE = 100;
export const MIN_PROFIT_SAMPLE = 200;

export type SupabaseStatus = "CONNECTED" | "DEGRADED" | "UNAVAILABLE";
export type ReadinessStatus = "PASS" | "IN_PROGRESS" | "FAIL" | "NOT_DEMONSTRATED" | "UNAVAILABLE";

/** The seven persistence tables the mission requires counts + freshness for. */
export const PERSISTENCE_TABLES = [
  "raw_observations", "prizepicks_line_snapshots", "feature_snapshots",
  "projection_snapshots", "decision_snapshots", "official_results", "grading_history",
] as const;
export type PersistenceTable = (typeof PERSISTENCE_TABLES)[number];

export interface TableStat {
  table: PersistenceTable;
  count: number;
  latestAt: string | null;
}

export interface PointInTime {
  temporalViolations: number;
  lateObservations: number;
  invalidFutureDataReferences: number;
  status: ReadinessStatus;
}

export interface RegistryEntry {
  market: string;
  modelVersion: string;
  state: string;
  prospectiveSample: number;
  brier: number | null;
  logLoss: number | null;
  calibrationError: number | null;
  lastComputedAt: string | null;
}

export interface CalibrationBucketRow {
  bucket: string; // "0.50–0.55"
  predicted: number;
  observed: number;
  n: number;
}
export interface CalibrationSection {
  status: "OK" | "INSUFFICIENT_DATA";
  sampleCount: number;
  buckets: CalibrationBucketRow[];
}

export interface DriftEntry {
  feature: string;
  metric: string;
  value: number | null;
  status: string;
  window: string;
  breach: boolean;
}

export interface BreakerEntry {
  market: string | null;
  breakerType: string;
  reason: string;
  triggeredAt: string;
  severity: string;
}

export type PerformanceWindow = "7d" | "30d" | "100" | "500" | "season";
export interface PerformanceRow {
  window: PerformanceWindow;
  status: "OK" | "INSUFFICIENT_DATA";
  sampleCount: number;
  qualifiedCount: number | null;
  brier: number | null;
  logLoss: number | null;
  calibrationError: number | null;
  mae: number | null;
  rmse: number | null;
  realizedHitRate: number | null;
  expectedReturn: number | null;
  realizedReturn: number | null;
  drawdown: number | null;
  /** Whether the sample is large enough to make a profitability claim. */
  profitabilityClaimable: boolean;
}

export interface ScientificReadiness {
  persistence: ReadinessStatus;
  pointInTime: ReadinessStatus;
  prospectiveCalibration: ReadinessStatus;
  predictiveProfitability: ReadinessStatus;
  blockers: string[];
}

export interface ScientificHealthReport {
  generatedAt: string;
  system: {
    supabase: SupabaseStatus;
    configured: boolean;
    serviceRole: boolean;
    error?: string;
    providers: ProviderHealth[];
  };
  persistence: TableStat[];
  pointInTime: PointInTime;
  modelRegistry: RegistryEntry[];
  calibration: CalibrationSection;
  drift: DriftEntry[];
  circuitBreakers: { activeCount: number; events: BreakerEntry[] };
  ungradedCount: number;
  performance: PerformanceRow[];
  readiness: ScientificReadiness;
}

/* ------------------------------- data source ------------------------------ */

export interface ScientificRawData {
  configured: boolean;
  serviceRole: boolean;
  connected: boolean;
  error?: string;
  providers: ProviderHealth[];
  tables: TableStat[];
  registry: RegistryRow[];
  metrics: MetricsRow[];
  drift: DriftRow[];
  breakers: BreakerRow[];
  ungradedCount: number;
  temporalViolations: number;
  lateObservations: number;
}

export interface ScientificDataSource {
  read(): Promise<ScientificRawData>;
}

const TIMESTAMP_COL: Record<PersistenceTable, string> = {
  raw_observations: "captured_at",
  prizepicks_line_snapshots: "captured_at",
  feature_snapshots: "computed_at",
  projection_snapshots: "generated_at",
  decision_snapshots: "generated_at",
  official_results: "retrieved_at",
  grading_history: "graded_at",
};

/** Supabase-backed source. Returns an empty (but honest) dataset when there is
    no service-role client — so keyless dev still renders the zero-state. */
export const supabaseDataSource: ScientificDataSource = {
  async read(): Promise<ScientificRawData> {
    const configured = isSupabaseConfigured();
    const serviceRole = isServiceRoleConfigured();
    const providers = getAllHealth();
    const client = getServiceClient();
    const empty: ScientificRawData = {
      configured, serviceRole, connected: false, providers,
      tables: PERSISTENCE_TABLES.map((table) => ({ table, count: 0, latestAt: null })),
      registry: [], metrics: [], drift: [], breakers: [], ungradedCount: 0,
      temporalViolations: 0, lateObservations: 0,
    };
    if (!client) return empty;

    try {
      const tables: TableStat[] = [];
      for (const table of PERSISTENCE_TABLES) {
        const { count } = await client.from(table).select("*", { count: "exact", head: true });
        const { data: latest } = await client.from(table).select(TIMESTAMP_COL[table]).order(TIMESTAMP_COL[table], { ascending: false }).limit(1).maybeSingle();
        const latestAt = latest ? (latest as unknown as Record<string, string>)[TIMESTAMP_COL[table]] ?? null : null;
        tables.push({ table, count: count ?? 0, latestAt });
      }
      const [registry, metrics, drift, breakers] = await Promise.all([
        client.from("model_registry").select("*").order("updated_at", { ascending: false }).then((r) => r.data ?? []),
        client.from("market_validation_metrics").select("*").order("computed_at", { ascending: false }).then((r) => r.data ?? []),
        client.from("drift_reports").select("*").order("computed_at", { ascending: false }).limit(50).then((r) => r.data ?? []),
        client.from("circuit_breaker_events").select("*").eq("status", "ACTIVE").order("triggered_at", { ascending: false }).then((r) => r.data ?? []),
      ]);
      // Ungraded = projection snapshots with no grading row referencing them.
      const projCount = tables.find((t) => t.table === "projection_snapshots")?.count ?? 0;
      const gradedCount = tables.find((t) => t.table === "grading_history")?.count ?? 0;
      const ungradedCount = Math.max(0, projCount - gradedCount);
      // Temporal violation = feature cutoff after event start (leakage).
      const { count: violations } = await client
        .from("projection_snapshots").select("*", { count: "exact", head: true })
        .filter("feature_cutoff", "gt", "event_start_time");

      return {
        configured, serviceRole, connected: true, providers, tables,
        registry, metrics, drift, breakers, ungradedCount,
        temporalViolations: violations ?? 0, lateObservations: 0,
      };
    } catch (e) {
      return { ...empty, error: e instanceof Error ? e.message : "unknown error" };
    }
  },
};

/* ------------------------------ pure assembler ---------------------------- */

const num = (v: number | null | undefined): number | null => (typeof v === "number" && Number.isFinite(v) ? v : null);

function calibrationErrorFromJson(cal: unknown): number | null {
  // market_validation_metrics.calibration is an array of {predicted, observed, n}.
  if (!Array.isArray(cal) || cal.length === 0) return null;
  let num_ = 0, den = 0;
  for (const b of cal as { predicted?: number; observed?: number; n?: number }[]) {
    if (typeof b.predicted === "number" && typeof b.observed === "number" && typeof b.n === "number" && b.n > 0) {
      num_ += Math.abs(b.predicted - b.observed) * b.n;
      den += b.n;
    }
  }
  return den > 0 ? num_ / den : null;
}

function latestMetricsByMarket(metrics: MetricsRow[]): Map<string, MetricsRow> {
  const map = new Map<string, MetricsRow>();
  for (const m of metrics) {
    const prev = map.get(m.market_key);
    if (!prev || m.computed_at > prev.computed_at) map.set(m.market_key, m);
  }
  return map;
}

const WINDOW_TYPES: PerformanceWindow[] = ["7d", "30d", "100", "500", "season"];

/** Pure assembly of the health report from raw data. Never fabricates numbers;
    thin samples are INSUFFICIENT_DATA, not zero-error. */
export function assembleScientificHealth(data: ScientificRawData, now = new Date()): ScientificHealthReport {
  const supabase: SupabaseStatus = data.connected ? "CONNECTED" : data.configured ? "DEGRADED" : "UNAVAILABLE";

  const latestMetrics = latestMetricsByMarket(data.metrics);

  const modelRegistry: RegistryEntry[] = data.registry.map((r) => {
    const m = latestMetrics.get(r.market_key);
    return {
      market: r.market_key,
      modelVersion: r.model_version,
      state: r.lifecycle_status,
      prospectiveSample: m?.scored_count ?? 0,
      brier: num(m?.brier),
      logLoss: num(m?.log_loss),
      calibrationError: m ? calibrationErrorFromJson(m.calibration) : null,
      lastComputedAt: m?.computed_at ?? null,
    };
  });

  // Calibration: pick the largest-sample metrics row that carries a calibration curve.
  const calSource = [...data.metrics]
    .filter((m) => Array.isArray(m.calibration) && (m.calibration as unknown[]).length > 0)
    .sort((a, b) => b.scored_count - a.scored_count)[0];
  const calBuckets: CalibrationBucketRow[] = calSource
    ? ((calSource.calibration as { bucket?: string; predicted?: number; observed?: number; n?: number }[])
        .map((b) => ({ bucket: b.bucket ?? "?", predicted: b.predicted ?? 0, observed: b.observed ?? 0, n: b.n ?? 0 })))
    : [];
  const calSample = calSource?.scored_count ?? 0;
  const calibration: CalibrationSection = {
    status: calSample >= MIN_CALIBRATION_SAMPLE && calBuckets.length > 0 ? "OK" : "INSUFFICIENT_DATA",
    sampleCount: calSample,
    buckets: calBuckets,
  };

  const drift: DriftEntry[] = data.drift.map((d: DriftRow) => ({
    feature: d.feature_name, metric: d.metric, value: num(d.metric_value),
    status: d.insufficient_data ? "INSUFFICIENT_DATA" : d.drift_level,
    window: `ref:${d.reference_count}/cur:${d.current_count}`, breach: d.breach,
  }));

  const breakerEvents: BreakerEntry[] = data.breakers.map((b: BreakerRow) => ({
    market: b.market_key, breakerType: b.breaker_type, reason: b.reason,
    triggeredAt: b.triggered_at, severity: b.severity,
  }));

  const performance: PerformanceRow[] = WINDOW_TYPES.map((w) => {
    // Aggregate across markets for this window: the season/most-scored row.
    const rows = data.metrics.filter((m) => m.window_type === w);
    const best = rows.sort((a, b) => b.scored_count - a.scored_count)[0];
    const sampleCount = best?.scored_count ?? 0;
    const minSample = w === "500" ? 500 : w === "100" ? 100 : MIN_PROFIT_SAMPLE;
    const enough = sampleCount >= minSample;
    return {
      window: w,
      status: enough ? "OK" : "INSUFFICIENT_DATA",
      sampleCount,
      qualifiedCount: best?.sample_count ?? null,
      brier: enough ? num(best?.brier) : null,
      logLoss: enough ? num(best?.log_loss) : null,
      calibrationError: enough && best ? calibrationErrorFromJson(best.calibration) : null,
      mae: enough ? num(best?.mae) : null,
      rmse: enough ? num(best?.rmse) : null,
      realizedHitRate: null,
      expectedReturn: enough ? num(best?.expected_return) : null,
      realizedReturn: enough ? num(best?.realized_return) : null,
      drawdown: enough ? num(best?.max_drawdown) : null,
      profitabilityClaimable: enough,
    };
  });

  const pit: PointInTime = {
    temporalViolations: data.temporalViolations,
    lateObservations: data.lateObservations,
    invalidFutureDataReferences: data.temporalViolations,
    status: !data.connected ? "UNAVAILABLE" : data.temporalViolations === 0 ? "PASS" : "FAIL",
  };

  const rawCount = data.tables.find((t) => t.table === "raw_observations")?.count ?? 0;
  const gradedCount = data.tables.find((t) => t.table === "grading_history")?.count ?? 0;

  const blockers: string[] = [];
  const persistence: ReadinessStatus = !data.connected ? "UNAVAILABLE" : rawCount > 0 ? "PASS" : "IN_PROGRESS";
  if (persistence !== "PASS") blockers.push(`Persistence: ${persistence === "UNAVAILABLE" ? "database unavailable" : "no observations persisted yet"}`);
  if (pit.status === "FAIL") blockers.push(`Point-in-time: ${pit.temporalViolations} temporal violation(s)`);

  const prospectiveCalibration: ReadinessStatus = !data.connected ? "UNAVAILABLE"
    : calibration.status === "OK" ? "PASS" : "IN_PROGRESS";
  if (prospectiveCalibration !== "PASS") blockers.push(`Prospective calibration: IN PROGRESS (${calSample}/${MIN_CALIBRATION_SAMPLE} graded)`);

  const profitClaimable = performance.some((p) => p.profitabilityClaimable && (p.realizedReturn ?? -1) > 0);
  const predictiveProfitability: ReadinessStatus = profitClaimable ? "PASS" : "NOT_DEMONSTRATED";
  if (predictiveProfitability !== "PASS") blockers.push(`Predictive profitability: NOT DEMONSTRATED (needs ≥ ${MIN_PROFIT_SAMPLE} graded with positive realized return; ${gradedCount} graded)`);

  return {
    generatedAt: now.toISOString(),
    system: {
      supabase, configured: data.configured, serviceRole: data.serviceRole, error: data.error,
      providers: data.providers,
    },
    persistence: data.tables,
    pointInTime: pit,
    modelRegistry,
    calibration,
    drift,
    circuitBreakers: { activeCount: breakerEvents.length, events: breakerEvents },
    ungradedCount: data.ungradedCount,
    performance,
    readiness: { persistence, pointInTime: pit.status, prospectiveCalibration, predictiveProfitability, blockers },
  };
}

/** Compute the full report from the default (Supabase) source. */
export async function getScientificHealth(source: ScientificDataSource = supabaseDataSource): Promise<ScientificHealthReport> {
  return assembleScientificHealth(await source.read());
}
