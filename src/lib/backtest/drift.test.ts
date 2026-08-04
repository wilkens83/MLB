import { test, expect, describe } from "bun:test";
import { populationStabilityIndex, categoricalPsi, classifyDrift, assessDrift, assessFeatureDrift, MIN_DRIFT_SAMPLE } from "./drift";

/** A deterministic pseudo-sample generator (no RNG dependency in tests). */
function ramp(n: number, base: number, spread: number): number[] {
  return Array.from({ length: n }, (_, i) => base + (i / n) * spread);
}

describe("populationStabilityIndex", () => {
  test("is ~0 when the two samples are identical", () => {
    const s = ramp(200, 0, 10);
    expect(populationStabilityIndex(s, s)).toBeLessThan(0.01);
  });

  test("grows as the actual distribution shifts away from expected", () => {
    const expected = ramp(400, 0, 10);
    const small = populationStabilityIndex(expected, ramp(400, 1, 10)); // shifted by 1
    const large = populationStabilityIndex(expected, ramp(400, 8, 10)); // shifted by 8
    expect(large).toBeGreaterThan(small);
  });

  test("returns 0 for empty input rather than throwing", () => {
    expect(populationStabilityIndex([], [1, 2, 3])).toBe(0);
    expect(populationStabilityIndex([1, 2, 3], [])).toBe(0);
  });
});

describe("classifyDrift thresholds", () => {
  test("stable below 0.1, moderate in [0.1,0.25), significant at/above 0.25", () => {
    expect(classifyDrift(0.05)).toBe("stable");
    expect(classifyDrift(0.1)).toBe("moderate");
    expect(classifyDrift(0.24)).toBe("moderate");
    expect(classifyDrift(0.25)).toBe("significant");
    expect(classifyDrift(1.2)).toBe("significant");
  });
});

describe("assessDrift", () => {
  test("does not breach when distributions match", () => {
    const s = ramp(300, 0, 10);
    const r = assessDrift(s, s);
    expect(r.level).toBe("stable");
    expect(r.breach).toBe(false);
  });

  test("breaches the circuit-breaker threshold on a large shift", () => {
    const expected = ramp(300, 0, 5);
    const shifted = ramp(300, 20, 5); // entirely disjoint support
    const r = assessDrift(expected, shifted);
    expect(r.level).toBe("significant");
    expect(r.breach).toBe(true);
  });
});

describe("insufficient data is NOT stable (PSI correction)", () => {
  test("empty samples resolve to insufficient_data and breach", () => {
    const r = assessDrift([], []);
    expect(r.level).toBe("insufficient_data");
    expect(r.insufficientData).toBe(true);
    expect(r.breach).toBe(true); // required feature with no evidence must block
  });

  test("a below-threshold current sample is insufficient, not stable", () => {
    const expected = ramp(100, 0, 10);
    const current = ramp(MIN_DRIFT_SAMPLE - 1, 0, 10); // just under the floor
    const r = assessDrift(expected, current);
    expect(r.level).toBe("insufficient_data");
    expect(r.breach).toBe(true);
  });

  test("a healthy sample count is assessed normally", () => {
    const s = ramp(MIN_DRIFT_SAMPLE + 5, 0, 10);
    expect(assessDrift(s, s).insufficientData).toBe(false);
  });
});

describe("categorical / binary drift uses category shares, not deciles", () => {
  test("identical categorical distributions are stable", () => {
    const a = Array.from({ length: 60 }, (_, i) => (i % 3 === 0 ? "L" : i % 3 === 1 ? "R" : "S"));
    expect(categoricalPsi(a, a)).toBeLessThan(0.01);
  });

  test("a shifted binary handedness split is flagged", () => {
    const ref = Array.from({ length: 100 }, (_, i) => (i < 50 ? "L" : "R")); // 50/50
    const cur = Array.from({ length: 100 }, (_, i) => (i < 90 ? "L" : "R")); // 90/10
    const r = assessFeatureDrift(ref, cur, { featureType: "binary" });
    expect(r.psi).toBeGreaterThan(0.1);
    expect(r.insufficientData).toBe(false);
  });

  test("feature-type drift also blocks on insufficient data", () => {
    const r = assessFeatureDrift(["L"], ["R"], { featureType: "categorical" });
    expect(r.level).toBe("insufficient_data");
    expect(r.breach).toBe(true);
  });
});
