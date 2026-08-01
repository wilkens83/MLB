import { test, expect, describe } from "bun:test";
import { estimatePitcherAllowedRates, expectedBattersFaced, estimatePaRates } from "./paSim";
import type { GameLogEntry } from "@/lib/domain/models";

const pitcherLog = (stat: Record<string, number>): GameLogEntry => ({ stat });

describe("estimatePitcherAllowedRates", () => {
  const log: GameLogEntry[] = [
    pitcherLog({ outs: 18, hits: 4, baseOnBalls: 2, homeRuns: 1, strikeOuts: 8, doubles: 1, triples: 0 }),
    pitcherLog({ outs: 15, hits: 6, baseOnBalls: 3, homeRuns: 0, strikeOuts: 6, doubles: 2, triples: 0 }),
    pitcherLog({ outs: 21, hits: 3, baseOnBalls: 1, homeRuns: 1, strikeOuts: 9, doubles: 0, triples: 0 }),
  ];

  test("returns valid probabilities that sum to 1", () => {
    const r = estimatePitcherAllowedRates(log);
    const sum = r.k + r.bb + r.hbp + r.single + r.double + r.triple + r.hr + r.out;
    expect(sum).toBeCloseTo(1, 6);
    for (const v of Object.values(r)) {
      expect(v).toBeGreaterThanOrEqual(0);
      expect(v).toBeLessThanOrEqual(1);
    }
  });

  test("a high-strikeout log yields an above-average K rate", () => {
    const r = estimatePitcherAllowedRates(log);
    expect(r.k).toBeGreaterThan(0.2);
  });

  test("empty log falls back to a valid league-ish distribution", () => {
    const r = estimatePitcherAllowedRates([]);
    const sum = r.k + r.bb + r.hbp + r.single + r.double + r.triple + r.hr + r.out;
    expect(sum).toBeCloseTo(1, 6);
  });
});

describe("expectedBattersFaced", () => {
  test("derives BF from outs + baserunners, clamped", () => {
    const bf = expectedBattersFaced([{ stat: { outs: 18, hits: 4, baseOnBalls: 2 } }]);
    expect(bf).toBeGreaterThanOrEqual(12);
    expect(bf).toBeLessThanOrEqual(32);
  });
  test("empty log falls back to 24", () => {
    expect(expectedBattersFaced([])).toBe(24);
  });
});

describe("estimatePaRates (hitter, existing) still valid", () => {
  test("sums to 1", () => {
    const r = estimatePaRates([{ stat: { atBats: 4, hits: 2, doubles: 1, homeRuns: 1, baseOnBalls: 1, strikeOuts: 1 } }]);
    const sum = r.k + r.bb + r.hbp + r.single + r.double + r.triple + r.hr + r.out;
    expect(sum).toBeCloseTo(1, 6);
  });
});
