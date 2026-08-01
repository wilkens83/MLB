import { test, expect, describe } from "bun:test";
import { poissonBinomial, analyzeEntryFromMarginals } from "./independence";

describe("poissonBinomial", () => {
  test("sums to 1 and matches the independent product at the tails", () => {
    const probs = [0.6, 0.5, 0.7];
    const d = poissonBinomial(probs);
    expect(d.reduce((a, b) => a + b, 0)).toBeCloseTo(1, 9);
    expect(d[3]).toBeCloseTo(0.6 * 0.5 * 0.7, 9); // all win
    expect(d[0]).toBeCloseTo(0.4 * 0.5 * 0.3, 9); // none win
  });

  test("two 0.5 legs → 0.25 / 0.5 / 0.25", () => {
    expect(poissonBinomial([0.5, 0.5])).toEqual([0.25, 0.5, 0.25]);
  });
});

describe("analyzeEntryFromMarginals", () => {
  test("is labeled an independence approximation with a prominent warning", () => {
    const r = analyzeEntryFromMarginals({ legProbabilities: [0.6, 0.55, 0.7], entryType: "flex" });
    expect(r.method).toBe("independence-approximation");
    expect(r.warnings.join(" ")).toMatch(/independence approximation/i);
    expect(r.probAllWin).toBeCloseTo(0.6 * 0.55 * 0.7, 6);
  });

  test("carries payout economics when a default table exists", () => {
    const r = analyzeEntryFromMarginals({ legProbabilities: [0.6, 0.6, 0.6], entryType: "power" });
    expect(r.economics.configured).toBe(true);
    expect(r.economics.expectedReturn).toBeCloseTo(0.6 ** 3 * 5, 4); // power-3 → 5×
  });
});
