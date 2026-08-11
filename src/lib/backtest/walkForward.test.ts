import { describe, it, expect } from "bun:test";
import { runWalkForwardBacktest, type WalkForwardSeries } from "./walkForward";
import { gradePrediction } from "./grader";
import { checkNoLeakage, freezeSnapshot, snapshotIsLeakageFree, attachContextEvents, type PredictionSnapshot } from "./snapshot";
import type { ContextEvent } from "@/lib/research/types";

/* ------------------------------- snapshot --------------------------------- */

describe("temporal-leakage guard (dataTimestamp <= predictionTimestamp < gameStartTime)", () => {
  it("accepts a clean pregame timeline", () => {
    expect(checkNoLeakage({ dataTimestamp: 100, predictionTimestamp: 150, gameStartTime: 200 }).ok).toBe(true);
  });
  it("rejects future data leaking into the forecast", () => {
    const c = checkNoLeakage({ dataTimestamp: 175, predictionTimestamp: 150, gameStartTime: 200 });
    expect(c.ok).toBe(false);
    expect(c.reason).toMatch(/future data/i);
  });
  it("rejects a prediction made at/after first pitch (not pregame)", () => {
    const c = checkNoLeakage({ dataTimestamp: 100, predictionTimestamp: 200, gameStartTime: 200 });
    expect(c.ok).toBe(false);
    expect(c.reason).toMatch(/pregame/i);
  });
  it("freezes a snapshot so it cannot be mutated in place", () => {
    const snap = { predictionTimestamp: 150, gameStartTime: 200, provenance: { dataTimestamp: 100, seed: "s", sources: [] } } as unknown as PredictionSnapshot;
    const frozen = freezeSnapshot(snap);
    expect(snapshotIsLeakageFree(frozen).ok).toBe(true);
    expect(() => { (frozen as unknown as { line: number }).line = 5; }).toThrow();
  });

  it("attaches only context events known at prediction time — future Reddit is excluded", () => {
    const ev = (id: string, fetchedAt: number): ContextEvent => ({
      id, playerId: 1, type: "pitch_limit", summary: "x", status: "unverified", confidence: 0.4,
      severity: "high", sourceType: "reddit",
      reddit: { mentions: 1, subreddits: [], firstSeenAt: fetchedAt, lastSeenAt: fetchedAt, uniqueThreads: 1 },
      credibility: { level: "low", reasons: [] }, sources: [], fetchedAt,
    });
    const predictionTimestamp = 150;
    const attached = attachContextEvents([ev("past", 100), ev("future", 200)], predictionTimestamp);
    expect(attached.map((e) => e.id)).toEqual(["past"]); // future event dropped (no leakage)
    expect(attached[0].summary).toBe("x");
  });
});

/* -------------------------------- grader ---------------------------------- */

describe("grading (reuses canonical over/under semantics; no re-derived prop formulas)", () => {
  it("grades an OVER win with Brier + log loss", () => {
    const g = gradePrediction({ predictionId: "p", line: 5.5, probOver: 0.7, projection: 6.2, actualValue: 8 });
    expect(g.result).toBe("win");
    expect(g.overOutcome).toBe(1);
    expect(g.squaredError).toBeCloseTo((0.7 - 1) ** 2, 6);
    expect(g.absoluteProjectionError).toBeCloseTo(1.8, 6);
  });
  it("grades an OVER loss", () => {
    const g = gradePrediction({ predictionId: "p", line: 5.5, probOver: 0.7, projection: 6.2, actualValue: 3 });
    expect(g.result).toBe("loss");
    expect(g.overOutcome).toBe(0);
    expect(g.squaredError).toBeCloseTo(0.49, 6);
  });
  it("marks a push (integer line hit exactly) and excludes it from Brier/log loss", () => {
    const g = gradePrediction({ predictionId: "p", line: 6, probOver: 0.6, projection: 6, actualValue: 6 });
    expect(g.result).toBe("push");
    expect(g.overOutcome).toBeUndefined();
    expect(Number.isNaN(g.squaredError)).toBe(true);
    expect(g.absoluteProjectionError).toBe(0);
  });
});

/* ----------------------------- walk-forward ------------------------------- */

function series(playerId: number, propKey: string, values: number[], family: "poisson" | "negbinom", paProbOver?: WalkForwardSeries["paProbOver"]): WalkForwardSeries {
  return { playerId, propKey, family, values, paProbOver };
}

// Deterministic pseudo-series (30 games) — hits (poisson) and strikeouts (negbinom).
const HITS = Array.from({ length: 30 }, (_, i) => [1, 0, 2, 1, 0, 1][i % 6]);
const KS = Array.from({ length: 30 }, (_, i) => [7, 5, 9, 6, 8, 10][i % 6]);

describe("runWalkForwardBacktest — chronological, leakage-free, per-model", () => {
  const report = runWalkForwardBacktest(
    [series(1, "hits", HITS, "poisson"), series(2, "strikeouts", KS, "negbinom")],
    { minimumHistory: 20, seed: "t" },
  );

  it("respects minimumHistory (30 games, minHistory 20 → 10 prediction-games per series)", () => {
    expect(report.predictions).toBe(20); // 10 per series × 2 series
  });

  it("scores baseline, marginal AND ensemble SEPARATELY (no PA offline)", () => {
    const ids = report.models.map((m) => m.modelId).sort();
    expect(ids).toEqual(["baseline", "ensemble", "marginal"]); // pa absent → not fabricated
    for (const m of report.models) {
      expect(m.count).toBeGreaterThan(0);
      expect(m.brier).toBeGreaterThanOrEqual(0);
      expect(m.brier).toBeLessThanOrEqual(1);
      expect(m.logLoss).toBeGreaterThanOrEqual(0);
    }
  });

  it("reports per-prop and ensemble segment breakdowns", () => {
    expect(Object.keys(report.byProp).sort()).toEqual(["hits", "strikeouts"]);
    expect(report.byProp.hits.some((m) => m.modelId === "ensemble")).toBe(true);
    // segments key off real severity/tier — at least one bucket is present
    expect(Object.keys(report.byDisagreement).length + Object.keys(report.byDataQuality).length).toBeGreaterThan(0);
  });

  it("is deterministic — the same series produce identical model scores", () => {
    const again = runWalkForwardBacktest(
      [series(1, "hits", HITS, "poisson"), series(2, "strikeouts", KS, "negbinom")],
      { minimumHistory: 20, seed: "t" },
    );
    expect(again.models).toEqual(report.models);
  });

  it("scores the PA model too when a PA probability is injected (Model B present)", () => {
    const withPa = runWalkForwardBacktest(
      [series(3, "hits", HITS, "poisson", () => ({ probOver: 0.62, projection: 1.1 }))],
      { minimumHistory: 20, seed: "t" },
    );
    expect(withPa.models.map((m) => m.modelId)).toContain("pa");
    const pa = withPa.models.find((m) => m.modelId === "pa")!;
    expect(pa.count).toBe(10);
  });

  it("warns rather than claiming superiority on a thin sample", () => {
    const thin = runWalkForwardBacktest([series(1, "hits", HITS.slice(0, 23), "poisson")], { minimumHistory: 20, seed: "t" });
    expect(thin.warnings.join(" ")).toMatch(/insufficient sample/i);
  });

  it("produces ensemble calibration bins (predicted vs observed), never fabricated", () => {
    for (const b of report.calibrationBins) {
      expect(b.predicted).toBeGreaterThanOrEqual(0);
      expect(b.predicted).toBeLessThanOrEqual(1);
      expect(b.observed).toBeGreaterThanOrEqual(0);
      expect(b.observed).toBeLessThanOrEqual(1);
      expect(b.n).toBeGreaterThan(0);
    }
  });
});
