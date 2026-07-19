import { test, expect, describe } from "bun:test";
import { project } from "./projection";
import { simulate, summarizeSamples, recommend } from "./simulate";
import {
  estimatePaRates, adjustPaRates, simulatePlateAppearances, LEAGUE_PA_RATES,
} from "./paSim";
import { buildAdjustmentBreakdown } from "./adjustments";
import { scoreDataQuality, buildWarnings } from "./quality";
import type { GameLogEntry, StatcastPitcher } from "@/lib/domain/models";

describe("projection", () => {
  test("small sample regresses toward the prior", () => {
    const big = project({ series: [3], family: "poisson", priorMean: 1, priorWeight: 4 });
    // one game of 3 with a prior of 1 (weight 4) => (3*1 + 1*4)/5 = 1.4
    expect(big.shrunkMean).toBeCloseTo(1.4, 2);
  });
  test("context multiplier is applied and clamped", () => {
    const p = project({ series: [2, 2, 2, 2], family: "poisson", context: { park: 1.1 } });
    expect(p.contextMultiplier).toBeCloseTo(1.1, 6);
    expect(p.lambda).toBeGreaterThan(p.shrunkMean);
  });
});

describe("simulate", () => {
  test("deterministic for a fixed seed", () => {
    const p = project({ series: [5, 6, 7, 8, 6, 7], family: "negbinom" });
    const a = simulate(p, 6.5, { seed: "x", iterations: 5000 });
    const b = simulate(p, 6.5, { seed: "x", iterations: 5000 });
    expect(a.probOver).toBe(b.probOver);
    expect(a.mean).toBe(b.mean);
  });
  test("probOver decreases as the line rises", () => {
    const p = project({ series: [5, 6, 7, 8, 6, 7], family: "negbinom" });
    const low = simulate(p, 4.5, { seed: "s" }).probOver;
    const high = simulate(p, 9.5, { seed: "s" }).probOver;
    expect(low).toBeGreaterThan(high);
  });
  test("distribution probabilities sum to ~1", () => {
    const p = project({ series: [1, 0, 2, 1, 0, 1], family: "poisson" });
    const sim = simulate(p, 0.5, { seed: "d" });
    const total = sim.distribution.reduce((s, b) => s + b.probability, 0);
    expect(total).toBeGreaterThan(0.9);
    expect(total).toBeLessThan(1.1);
  });
  test("summarizeSamples computes over/under/push", () => {
    const s = summarizeSamples([0, 1, 1, 2, 2, 2], 1, "poisson");
    expect(s.probPush).toBeCloseTo(2 / 6, 3); // two samples equal to line (rounded to 4dp)
    expect(s.probOver).toBeCloseTo(3 / 6, 3);
  });
});

describe("recommend", () => {
  test("+EV over produces an over lean", () => {
    const p = project({ series: [8, 9, 10, 9, 8, 11, 9], family: "negbinom" });
    const sim = simulate(p, 6.5, { seed: "r" });
    const rec = recommend({ sim, overAmerican: 120, underAmerican: -140, sampleSize: 7 });
    expect(rec.best?.side).toBe("over");
    expect(rec.recommendation.includes("over")).toBe(true);
  });
  test("no price => pass", () => {
    const p = project({ series: [1, 2, 1], family: "poisson" });
    const sim = simulate(p, 0.5, { seed: "r2" });
    const rec = recommend({ sim, sampleSize: 3 });
    expect(rec.recommendation).toBe("pass");
  });
});

describe("plate-appearance simulation", () => {
  const log: GameLogEntry[] = Array.from({ length: 40 }, () => ({
    stat: { atBats: 4, baseOnBalls: 1, hitByPitch: 0, hits: 1, doubles: 0, triples: 0, homeRuns: 0, strikeOuts: 1 },
  }));

  test("estimated PA rates sum to 1", () => {
    const rates = estimatePaRates(log);
    const total = rates.k + rates.bb + rates.hbp + rates.single + rates.double + rates.triple + rates.hr + rates.out;
    expect(total).toBeCloseTo(1, 6);
  });
  test("adjusted rates remain a valid distribution", () => {
    const rates = adjustPaRates(LEAGUE_PA_RATES, { kMult: 1.3, offenseMult: 1.2 });
    const total = rates.k + rates.bb + rates.hbp + rates.single + rates.double + rates.triple + rates.hr + rates.out;
    expect(total).toBeCloseTo(1, 6);
    expect(rates.k).toBeGreaterThan(LEAGUE_PA_RATES.k * 0.9); // K share raised
  });
  test("simulated hit mean ≈ expected (rate × PAs)", () => {
    const rates = estimatePaRates(log); // ~1 hit + some via league blend over ~5 PA
    const res = simulatePlateAppearances(rates, { hits: 0.5 }, { iterations: 8000, seed: "pa", expectedPa: 4.3 });
    const expectedHits = (rates.single + rates.double + rates.triple + rates.hr) * 4.3;
    expect(res.hits.mean).toBeGreaterThan(expectedHits - 0.3);
    expect(res.hits.mean).toBeLessThan(expectedHits + 0.3);
  });
  test("higher K rate raises simulated strikeouts", () => {
    const base = estimatePaRates(log);
    const hot = adjustPaRates(base, { kMult: 1.6 });
    const lo = simulatePlateAppearances(base, { batter_strikeouts: 0.5 }, { seed: "a", expectedPa: 4.3 }).batter_strikeouts.mean;
    const hi = simulatePlateAppearances(hot, { batter_strikeouts: 0.5 }, { seed: "a", expectedPa: 4.3 }).batter_strikeouts.mean;
    expect(hi).toBeGreaterThan(lo);
  });
});

describe("adjustment breakdown", () => {
  test("reconciles base -> final via additive deltas", () => {
    const pitcher: StatcastPitcher = { playerId: 1, season: 2025, xwoba: 0.28, availableMetrics: ["xwoba"], fetchedAt: Date.now() };
    const b = buildAdjustmentBreakdown({
      propKey: "total_bases", base: 1.5, venueName: "Coors Field",
      batterHand: "R", opposingPitcher: pitcher, opposingPitcherHand: "L", formRatio: 1.1,
    });
    const summed = b.base + b.factors.reduce((s, f) => s + f.delta, 0);
    expect(summed).toBeCloseTo(b.final, 2);
    expect(b.factors.length).toBeGreaterThan(0);
  });
  test("a suppressing pitcher lowers the projection", () => {
    const nasty: StatcastPitcher = { playerId: 2, season: 2025, xwoba: 0.26, availableMetrics: ["xwoba"], fetchedAt: Date.now() };
    const b = buildAdjustmentBreakdown({ propKey: "hits", base: 1.0, opposingPitcher: nasty });
    const opp = b.factors.find((f) => f.key === "opponent");
    expect(opp?.direction).toBe("down");
  });
});

describe("data quality & warnings", () => {
  test("more data + sources => higher score/tier", () => {
    const lo = scoreDataQuality({ sampleSize: 3, hasStatcast: false, hasOpponent: false, hasWeather: false, hasLineup: false });
    const hi = scoreDataQuality({ sampleSize: 40, hasStatcast: true, hasOpponent: true, hasWeather: true, hasLineup: true });
    expect(hi.score).toBeGreaterThan(lo.score);
    expect(hi.tier).toBe("high");
    expect(lo.tier).toBe("low");
  });
  test("small sample raises a high-severity warning", () => {
    const w = buildWarnings({ sampleSize: 3, hasStatcast: true, hasOpponent: true, hasWeather: true, lineupConfirmed: true, starterConfirmed: true, manualOdds: false });
    expect(w.some((x) => x.code === "small_sample" && x.severity === "high")).toBe(true);
  });
});
