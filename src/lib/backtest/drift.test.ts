import { test, expect, describe } from "bun:test";
import { populationStabilityIndex, classifyDrift, assessDrift } from "./drift";

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
