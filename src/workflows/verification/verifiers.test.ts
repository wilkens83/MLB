import { test, expect, describe } from "bun:test";
import {
  probabilityBoundsVerifier, sampleQualityVerifier, projectionSanityVerifier,
  simulationStabilityVerifier, crossMethodAgreementVerifier, oddsMathVerifier,
  freshnessVerifier, recommendationVerifier, dataCompletenessVerifier, aggregate,
} from "./verifiers";

describe("independent verifiers (deterministic, do not trust production fns)", () => {
  test("probability bounds: rejects out-of-range and non-summing", () => {
    expect(probabilityBoundsVerifier({ over: 0.6, under: 0.35, push: 0.05 }).passed).toBe(true);
    expect(probabilityBoundsVerifier({ over: 1.2, under: 0, push: 0 }).passed).toBe(false);
    expect(probabilityBoundsVerifier({ over: NaN, under: 0.5, push: 0.5 }).passed).toBe(false);
    expect(probabilityBoundsVerifier({ over: 0.6, under: 0.6, push: 0 }).passed).toBe(false);
  });

  test("sample quality gates on minimum", () => {
    expect(sampleQualityVerifier(5, 10).passed).toBe(false);
    expect(sampleQualityVerifier(12, 10).passed).toBe(true);
  });

  test("projection sanity rejects NaN/negative counts", () => {
    expect(projectionSanityVerifier(1.7).passed).toBe(true);
    expect(projectionSanityVerifier(-1).passed).toBe(false);
    expect(projectionSanityVerifier(Infinity).passed).toBe(false);
  });

  test("simulation stability needs enough iterations", () => {
    expect(simulationStabilityVerifier(10000, 1.2).passed).toBe(true);
    expect(simulationStabilityVerifier(100, 1.2).passed).toBe(false);
    expect(simulationStabilityVerifier(10000, NaN).passed).toBe(false);
  });

  test("cross-method agreement flags large disagreement", () => {
    expect(crossMethodAgreementVerifier(0.6, 0.62).passed).toBe(true);
    expect(crossMethodAgreementVerifier(0.6, 0.9).passed).toBe(false);
  });

  test("odds math rejects impossible odds and skips when absent", () => {
    expect(oddsMathVerifier(-110).passed).toBe(true);
    expect(oddsMathVerifier(undefined).passed).toBe(true); // skipped
    expect(oddsMathVerifier(0).passed).toBe(false);
  });

  test("freshness rejects leakage and stale lineup", () => {
    expect(freshnessVerifier({ featureCutoff: "2026-07-31T23:30:00Z", eventStartTime: "2026-07-31T23:00:00Z" }).passed).toBe(false);
    expect(freshnessVerifier({ requireLineup: true, lineupConfirmed: false }).passed).toBe(false);
    expect(freshnessVerifier({ featureCutoff: "2026-07-31T20:00:00Z", eventStartTime: "2026-07-31T23:00:00Z" }).passed).toBe(true);
  });

  test("recommendation consistency", () => {
    expect(recommendationVerifier({ side: "over", probability: 0.6, status: "ok" }).passed).toBe(true);
    expect(recommendationVerifier({ status: "ok", probability: 0.6 }).passed).toBe(false); // ok without side
    expect(recommendationVerifier({ status: "insufficient-data" }).passed).toBe(true);
  });

  test("data completeness detects missing fields", () => {
    expect(dataCompletenessVerifier({ a: 1, b: 2 }, ["a", "b"]).passed).toBe(true);
    expect(dataCompletenessVerifier({ a: 1 }, ["a", "b"]).passed).toBe(false);
  });

  test("aggregate collects rejection codes", () => {
    const r = aggregate([
      sampleQualityVerifier(5, 10),
      probabilityBoundsVerifier({ over: 0.6, under: 0.4, push: 0 }),
    ]);
    expect(r.passed).toBe(false);
    expect(r.rejections).toContain("SAMPLE_TOO_SMALL");
  });
});
