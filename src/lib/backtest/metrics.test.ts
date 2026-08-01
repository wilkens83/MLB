import { test, expect, describe } from "bun:test";
import { computeBacktest, type ProjectionSnapshot, type GradedResult } from "./metrics";

let seq = 0;
function snap(p: Partial<ProjectionSnapshot> = {}): ProjectionSnapshot {
  seq++;
  return {
    id: p.id ?? `s${seq}`,
    playerId: p.playerId ?? seq,
    gamePk: p.gamePk ?? 1,
    market: p.market ?? "strikeouts",
    direction: p.direction ?? "more",
    line: p.line ?? 5.5,
    probWin: p.probWin ?? 0.6,
    projectedMean: p.projectedMean,
    confidence: p.confidence ?? 65,
    dataQuality: p.dataQuality ?? 70,
    modelVersion: p.modelVersion ?? "2.0.0",
    lineupStatus: p.lineupStatus ?? "projected",
    capturedAt: p.capturedAt ?? `2026-07-0${(seq % 9) + 1}T18:00:00Z`,
    gameStartAt: p.gameStartAt ?? `2026-07-0${(seq % 9) + 1}T23:00:00Z`,
    featureCutoff: p.featureCutoff,
  };
}
const res = (id: string, grade: GradedResult["grade"], actual = 0): GradedResult => ({ id, grade, actual });

describe("computeBacktest — core scoring", () => {
  test("counts wins/losses/pushes and hit rate", () => {
    seq = 0;
    const snaps = [snap({ id: "a" }), snap({ id: "b" }), snap({ id: "c" }), snap({ id: "d" })];
    const results = [res("a", "win"), res("b", "loss"), res("c", "win"), res("d", "push")];
    const r = computeBacktest(snaps, results);
    expect(r.wins).toBe(2);
    expect(r.losses).toBe(1);
    expect(r.pushes).toBe(1);
    expect(r.scored).toBe(3);
    expect(r.hitRate).toBeCloseTo(2 / 3, 4);
  });

  test("Brier ~0 and logLoss ~0 for confident correct predictions", () => {
    seq = 0;
    const snaps = [snap({ id: "a", probWin: 1 }), snap({ id: "b", probWin: 1 })];
    const r = computeBacktest(snaps, [res("a", "win"), res("b", "win")]);
    expect(r.brierScore).toBeLessThan(0.001);
    expect(r.logLoss).toBeLessThan(0.001);
  });

  test("Brier = 0.25 for coin-flip predictions on an even split", () => {
    seq = 0;
    const snaps = [snap({ id: "a", probWin: 0.5 }), snap({ id: "b", probWin: 0.5 })];
    const r = computeBacktest(snaps, [res("a", "win"), res("b", "loss")]);
    expect(r.brierScore).toBeCloseTo(0.25, 6);
  });
});

describe("temporal leakage + matching guards", () => {
  test("excludes snapshots whose feature cutoff is after game start", () => {
    seq = 0;
    const leaked = snap({ id: "leak", featureCutoff: "2026-07-01T23:30:00Z", gameStartAt: "2026-07-01T23:00:00Z" });
    const clean = snap({ id: "ok", featureCutoff: "2026-07-01T22:00:00Z", gameStartAt: "2026-07-01T23:00:00Z" });
    const r = computeBacktest([leaked, clean], [res("leak", "win"), res("ok", "win")]);
    expect(r.leakageExcluded).toBe(1);
    expect(r.scored).toBe(1);
    expect(r.warnings.join(" ")).toMatch(/leakage/i);
  });

  test("counts unmatched snapshots", () => {
    seq = 0;
    const r = computeBacktest([snap({ id: "a" })], []);
    expect(r.unmatched).toBe(1);
    expect(r.scored).toBe(0);
  });
});

describe("MAE / RMSE + segmentation", () => {
  test("MAE and RMSE use projected mean vs actual", () => {
    seq = 0;
    const snaps = [snap({ id: "a", projectedMean: 6, probWin: 0.6 }), snap({ id: "b", projectedMean: 4, probWin: 0.6 })];
    const r = computeBacktest(snaps, [res("a", "win", 7), res("b", "loss", 3)]); // errors: 1 and 1
    expect(r.meanAbsoluteError).toBeCloseTo(1, 6);
    expect(r.rmse).toBeCloseTo(1, 6);
  });

  test("segments by market and model version", () => {
    seq = 0;
    const snaps = [
      snap({ id: "a", market: "strikeouts", modelVersion: "2.0.0" }),
      snap({ id: "b", market: "home_runs", modelVersion: "2.0.0" }),
      snap({ id: "c", market: "strikeouts", modelVersion: "2.1.0" }),
    ];
    const r = computeBacktest(snaps, [res("a", "win"), res("b", "loss"), res("c", "win")]);
    expect(r.byMarket.find((s) => s.key === "strikeouts")?.n).toBe(2);
    expect(r.byModelVersion.length).toBe(2);
  });

  test("computes an even-money max drawdown", () => {
    seq = 0;
    // W, L, L, L → equity 1,0,-1,-2; peak 1; drawdown 3.
    const snaps = [
      snap({ id: "a", capturedAt: "2026-07-01T10:00:00Z" }),
      snap({ id: "b", capturedAt: "2026-07-02T10:00:00Z" }),
      snap({ id: "c", capturedAt: "2026-07-03T10:00:00Z" }),
      snap({ id: "d", capturedAt: "2026-07-04T10:00:00Z" }),
    ];
    const r = computeBacktest(snaps, [res("a", "win"), res("b", "loss"), res("c", "loss"), res("d", "loss")]);
    expect(r.maxDrawdown).toBe(3);
  });
});
