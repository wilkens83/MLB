import { describe, it, expect } from "bun:test";
import {
  assembleScientificHealth, PERSISTENCE_TABLES,
  type ScientificRawData,
} from "./scientific-health";

function raw(over: Partial<ScientificRawData> = {}): ScientificRawData {
  return {
    configured: false, serviceRole: false, connected: false, providers: [],
    tables: PERSISTENCE_TABLES.map((table) => ({ table, count: 0, latestAt: null })),
    registry: [], metrics: [], drift: [], breakers: [], ungradedCount: 0,
    temporalViolations: 0, lateObservations: 0, ...over,
  };
}

const metricsRow = (over: Record<string, unknown> = {}) => ({
  id: "m1", market_key: "strikeouts", model_id: "mod1", window_type: "season",
  window_start: null, window_end: null, segment: null,
  sample_count: 120, scored_count: 300, brier: 0.19, log_loss: 0.56,
  mae: 1.1, rmse: 1.5, expected_return: 0.03, realized_return: 0.05, max_drawdown: -0.2,
  longest_losing_streak: 4, baseline_comparison: null,
  calibration: [{ bucket: "0.50-0.55", predicted: 0.52, observed: 0.51, n: 150 }, { bucket: "0.55-0.60", predicted: 0.57, observed: 0.54, n: 150 }],
  computed_at: "2026-08-01T00:00:00Z", ...over,
}) as unknown as ScientificRawData["metrics"][number];

describe("scientific health — zero data is INSUFFICIENT DATA, never zero-error perfection", () => {
  it("reports UNAVAILABLE + blockers when Supabase is not connected", () => {
    const r = assembleScientificHealth(raw());
    expect(r.system.supabase).toBe("UNAVAILABLE");
    expect(r.readiness.persistence).toBe("UNAVAILABLE");
    expect(r.readiness.predictiveProfitability).toBe("NOT_DEMONSTRATED");
    expect(r.readiness.blockers.length).toBeGreaterThan(0);
    // No fabricated perfection: calibration insufficient, performance null metrics.
    expect(r.calibration.status).toBe("INSUFFICIENT_DATA");
    for (const p of r.performance) {
      expect(p.status).toBe("INSUFFICIENT_DATA");
      expect(p.brier).toBeNull(); // NOT 0
      expect(p.profitabilityClaimable).toBe(false);
    }
  });

  it("connected but zero observations ⇒ persistence IN_PROGRESS, point-in-time PASS", () => {
    const r = assembleScientificHealth(raw({ configured: true, serviceRole: true, connected: true }));
    expect(r.system.supabase).toBe("CONNECTED");
    expect(r.readiness.persistence).toBe("IN_PROGRESS");
    expect(r.pointInTime.status).toBe("PASS"); // 0 violations
    expect(r.readiness.predictiveProfitability).toBe("NOT_DEMONSTRATED");
  });

  it("surfaces temporal violations as a FAIL", () => {
    const r = assembleScientificHealth(raw({ connected: true, temporalViolations: 3 }));
    expect(r.pointInTime.status).toBe("FAIL");
    expect(r.pointInTime.invalidFutureDataReferences).toBe(3);
    expect(r.readiness.blockers.some((b) => b.includes("Point-in-time"))).toBe(true);
  });
});

describe("scientific health — populated records", () => {
  const populated = raw({
    configured: true, serviceRole: true, connected: true,
    tables: PERSISTENCE_TABLES.map((table) => ({
      table, count: table === "raw_observations" ? 5000 : table === "grading_history" ? 300 : table === "projection_snapshots" ? 400 : 100,
      latestAt: "2026-08-01T12:00:00Z",
    })),
    registry: [{
      id: "r1", market_key: "strikeouts", model_name: "sk", model_version: "v3", feature_version: "f2",
      lifecycle_status: "VALIDATED", algorithm: null, git_commit_sha: null, hyperparameters: null,
      created_at: "x", updated_at: "x", approved_at: null, approved_by: null, retired_at: null,
      suspended_at: null, suspended_reason: null, training_data_hash: null, training_period_end: null,
      training_period_start: null, training_support: null, validation_period_end: null, validation_period_start: null,
    }] as unknown as ScientificRawData["registry"],
    metrics: [metricsRow()],
    drift: [{
      id: "d1", market_key: "strikeouts", model_id: "mod1", feature_name: "k_rate", feature_type: "numeric",
      metric: "psi", metric_value: 0.31, drift_level: "significant", breach: true, insufficient_data: false,
      reference_count: 500, current_count: 120, reference_window: null, current_window: null,
      thresholds: null, computed_at: "2026-08-01T00:00:00Z",
    }] as unknown as ScientificRawData["drift"],
    breakers: [{
      id: "b1", market_key: "strikeouts", breaker_type: "CALIBRATION", reason: "calibration degraded",
      triggered_at: "2026-08-01T00:00:00Z", severity: "HIGH", status: "ACTIVE",
      decision_snapshot_id: null, evidence: null, game_pk: null, model_id: null,
      recovery_condition: null, resolution_note: null, resolved_at: null, resolved_by: null,
    }] as unknown as ScientificRawData["breakers"],
    ungradedCount: 100,
  });

  it("maps the model registry with metrics + calibration error", () => {
    const r = assembleScientificHealth(populated);
    expect(r.modelRegistry.length).toBe(1);
    const e = r.modelRegistry[0];
    expect(e.market).toBe("strikeouts");
    expect(e.state).toBe("VALIDATED");
    expect(e.modelVersion).toBe("v3");
    expect(e.prospectiveSample).toBe(300);
    expect(e.brier).toBeCloseTo(0.19, 3);
    expect(e.calibrationError).toBeGreaterThan(0); // weighted |predicted-observed|
  });

  it("shows calibration buckets (from Supabase), drift, breakers, and ungraded", () => {
    const r = assembleScientificHealth(populated);
    expect(r.calibration.status).toBe("OK");
    expect(r.calibration.buckets.length).toBe(2);
    expect(r.drift[0].feature).toBe("k_rate");
    expect(r.circuitBreakers.activeCount).toBe(1);
    expect(r.circuitBreakers.events[0].breakerType).toBe("CALIBRATION");
    expect(r.ungradedCount).toBe(100);
  });

  it("claims profitability ONLY when sample + positive realized return are present", () => {
    const r = assembleScientificHealth(populated); // season scored_count 300 ≥ 200, realized 0.05 > 0
    const season = r.performance.find((p) => p.window === "season")!;
    expect(season.status).toBe("OK");
    expect(season.profitabilityClaimable).toBe(true);
    expect(r.readiness.predictiveProfitability).toBe("PASS");

    // Thin sample ⇒ no claim even with positive return.
    const thin = assembleScientificHealth(raw({
      connected: true, metrics: [metricsRow({ scored_count: 20, sample_count: 10 })],
    }));
    const s2 = thin.performance.find((p) => p.window === "season")!;
    expect(s2.status).toBe("INSUFFICIENT_DATA");
    expect(s2.realizedReturn).toBeNull();
    expect(thin.readiness.predictiveProfitability).toBe("NOT_DEMONSTRATED");
  });
});
