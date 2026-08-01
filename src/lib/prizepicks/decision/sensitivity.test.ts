import { test, expect, describe } from "bun:test";
import { runSensitivity, type SensitivityInput } from "./sensitivity";
import { deriveMarketValidationState } from "./market-validation";
import type { PaRates } from "@/lib/prediction/paSim";

const HIGH_K: PaRates = { k: 0.34, bb: 0.06, hbp: 0.01, single: 0.12, double: 0.035, triple: 0.003, hr: 0.022, out: 0.41 };

describe("runSensitivity", () => {
  const base: SensitivityInput = { kind: "pitcher", market: "strikeouts", line: 5.5, direction: "more", rates: HIGH_K, expected: 24, seed: "t" };

  test("returns base/worst/best with worst ≤ base ≤ best and a fragility score", () => {
    const r = runSensitivity(base);
    expect(r.worstProbability).toBeLessThanOrEqual(r.baseProbability);
    expect(r.bestProbability).toBeGreaterThanOrEqual(r.baseProbability);
    expect(r.fragilityScore).toBeGreaterThanOrEqual(0);
    expect(r.fragilityScore).toBeLessThanOrEqual(100);
    expect(r.scenarios.length).toBe(6);
    expect(r.mostInfluentialAssumption).toBeTruthy();
  });

  test("is deterministic for a seed", () => {
    expect(runSensitivity(base)).toEqual(runSensitivity(base));
  });

  test("a line far below the mean is robust (small range)", () => {
    const r = runSensitivity({ ...base, line: 0.5 });
    expect(r.baseProbability).toBeGreaterThan(0.95);
    expect(r.probabilityRange).toBeLessThan(0.1);
  });
});

describe("deriveMarketValidationState", () => {
  test("RESEARCH_ONLY when the forward sample is too small", () => {
    expect(deriveMarketValidationState({ gradedCount: 20 }).state).toBe("RESEARCH_ONLY");
  });
  test("SUSPENDED on drift or poor Brier", () => {
    expect(deriveMarketValidationState({ gradedCount: 500, driftDetected: true }).state).toBe("SUSPENDED");
    expect(deriveMarketValidationState({ gradedCount: 500, brierScore: 0.30 }).state).toBe("SUSPENDED");
  });
  test("PROVISIONAL with enough sample but not-yet-strong calibration", () => {
    expect(deriveMarketValidationState({ gradedCount: 150, brierScore: 0.24 }).state).toBe("PROVISIONAL");
  });
  test("VALIDATED with large sample + good calibration", () => {
    expect(deriveMarketValidationState({ gradedCount: 400, brierScore: 0.2, calibrationError: 0.04 }).state).toBe("VALIDATED");
  });
});
