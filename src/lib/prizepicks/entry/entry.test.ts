import { test, expect, describe } from "bun:test";
import { analyzeEntry, type EntryLegInput } from "./entry";
import { defaultPayoutTable } from "./payout";
import { correlation } from "./correlation";
import type { PaRates } from "@/lib/prediction/paSim";

const PITCHER_ALLOWED: PaRates = { k: 0.30, bb: 0.06, hbp: 0.01, single: 0.13, double: 0.04, triple: 0.003, hr: 0.025, out: 0.432 };
const HITTER: PaRates = { k: 0.24, bb: 0.10, hbp: 0.01, single: 0.14, double: 0.05, triple: 0.005, hr: 0.05, out: 0.405 };

const pitcherLeg = (id: string, market: string, line: number, direction: "more" | "less" = "more", gamePk = 1): EntryLegInput => ({
  id, label: `${id} ${market}`, playerId: 100, gamePk, market, direction, line,
  model: { kind: "pitcher", allowedRates: PITCHER_ALLOWED, expectedBF: 24 },
});
const hitterLeg = (id: string, market: string, line: number, playerId: number, direction: "more" | "less" = "more"): EntryLegInput => ({
  id, label: `${id} ${market}`, playerId, gamePk: 2, market, direction, line,
  model: { kind: "hitter", rates: HITTER, expectedPa: 4.3 },
});

describe("analyzeEntry — distribution + determinism", () => {
  test("is deterministic for a seed", () => {
    const legs = [pitcherLeg("a", "strikeouts", 5.5), hitterLeg("b", "total_bases", 1.5, 200)];
    const r1 = analyzeEntry({ legs, entryType: "power", iterations: 3000, seed: "s" });
    const r2 = analyzeEntry({ legs, entryType: "power", iterations: 3000, seed: "s" });
    expect(r1.probAllWin).toBe(r2.probAllWin);
    expect(r1.distribution).toEqual(r2.distribution);
  });

  test("distribution sums to 1 and probAllWin == distribution[size]", () => {
    const legs = [pitcherLeg("a", "strikeouts", 5.5), hitterLeg("b", "total_bases", 1.5, 200), hitterLeg("c", "hits", 0.5, 201)];
    const r = analyzeEntry({ legs, entryType: "flex", iterations: 4000, seed: "s" });
    const sum = r.distribution.reduce((x, y) => x + y, 0);
    expect(sum).toBeCloseTo(1, 6);
    expect(r.probAllWin).toBeCloseTo(r.distribution[3], 10);
    expect(r.distribution).toHaveLength(4);
  });

  test("each leg probWin is in [0,1] and consistent with a strong line", () => {
    const legs = [pitcherLeg("a", "strikeouts", 0.5)]; // very low line → high win prob
    const r = analyzeEntry({ legs, entryType: "power", iterations: 3000, seed: "s" });
    expect(r.legs[0].probWin).toBeGreaterThan(0.9);
  });
});

describe("correlation + contradiction", () => {
  test("same-pitcher strikeouts & outs are positively correlated (joint sim)", () => {
    const legs = [pitcherLeg("k", "strikeouts", 5.5), pitcherLeg("o", "pitcher_outs", 17.5)];
    const r = analyzeEntry({ legs, entryType: "power", iterations: 5000, seed: "s" });
    const pair = r.correlations[0];
    expect(pair.sameUnit).toBe(true);
    expect(pair.correlation).toBeGreaterThan(0.1);
  });

  test("More strikeouts + More hits-allowed on the same pitcher is flagged contradictory", () => {
    const legs = [pitcherLeg("k", "strikeouts", 5.5, "more"), pitcherLeg("h", "hits_allowed", 5.5, "more")];
    const r = analyzeEntry({ legs, entryType: "power", iterations: 3000, seed: "s" });
    expect(r.contradictions.length).toBe(1);
    expect(r.contradictions[0].note).toMatch(/negatively related|opposite/i);
  });

  test("different players are (near) independent", () => {
    const legs = [hitterLeg("a", "total_bases", 1.5, 300), hitterLeg("b", "total_bases", 1.5, 301)];
    const r = analyzeEntry({ legs, entryType: "power", iterations: 6000, seed: "s" });
    expect(Math.abs(r.correlations[0].correlation)).toBeLessThan(0.1);
  });

  test("correlation() basic identities", () => {
    expect(correlation([1, 0, 1, 0], [1, 0, 1, 0])).toBeCloseTo(1, 6);
    expect(correlation([1, 0, 1, 0], [0, 1, 0, 1])).toBeCloseTo(-1, 6);
    expect(correlation([1, 1, 1], [0, 1, 0])).toBe(0); // constant vector → 0
  });
});

describe("payout", () => {
  test("power EV uses distribution[size] * multiplier", () => {
    const legs = [pitcherLeg("a", "strikeouts", 5.5), hitterLeg("b", "total_bases", 1.5, 200)];
    const table = defaultPayoutTable("power", 2); // { 2: 3 }
    const r = analyzeEntry({ legs, entryType: "power", iterations: 4000, seed: "s", payoutTable: table });
    expect(r.payout.ev).toBeCloseTo(r.probAllWin * 3, 3);
  });

  test("flex EV rewards partial hits", () => {
    const legs = [
      hitterLeg("a", "total_bases", 1.5, 200),
      hitterLeg("b", "total_bases", 1.5, 201),
      hitterLeg("c", "total_bases", 1.5, 202),
    ];
    const r = analyzeEntry({ legs, entryType: "flex", iterations: 4000, seed: "s" });
    // 3-pick flex pays on 2 correct too → EV strictly greater than power-only all-3.
    expect(r.payout.ev).toBeGreaterThan(r.probAllWin * 2.25);
  });
});

describe("unsupported markets", () => {
  test("runs/RBIs are flagged and excluded from the distribution", () => {
    const legs = [hitterLeg("a", "runs", 0.5, 200), hitterLeg("b", "total_bases", 1.5, 201)];
    const r = analyzeEntry({ legs, entryType: "power", iterations: 2000, seed: "s" });
    expect(r.legs.find((l) => l.market === "runs")?.supported).toBe(false);
    expect(r.warnings.join(" ")).toMatch(/not modeled/i);
  });
});
