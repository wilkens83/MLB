import { test, expect, describe } from "bun:test";
import { assessProjection, type AssessmentInput } from "./assessment";

const clean: AssessmentInput = {
  probabilityMore: 0.64,
  probabilityLess: 0.36,
  probabilityPush: 0,
  confidenceScore: 78,
  dataQualityScore: 82,
  volatilityScore: 40,
  fragilityScore: 30,
  playerResolved: true,
  gameResolved: true,
  marketMapped: true,
  snapshotBeforeEvent: true,
  lineupConfirmed: true,
  starterConfirmed: true,
  sampleSizeAdequate: true,
};

describe("assessProjection", () => {
  test("REVIEW when all research thresholds are met", () => {
    const a = assessProjection(clean);
    expect(a.status).toBe("REVIEW");
    expect(a.directionalProbability).toBeCloseTo(0.64, 6);
  });

  test("NO_EDGE when directional probability is below 0.58 with clean data", () => {
    expect(assessProjection({ ...clean, probabilityMore: 0.55, probabilityLess: 0.45 }).status).toBe("NO_EDGE");
  });

  test("WAIT when the lineup is unconfirmed even with high probability", () => {
    const a = assessProjection({ ...clean, lineupConfirmed: false });
    expect(a.status).toBe("WAIT");
    expect(a.warnings.join(" ")).toMatch(/lineup/i);
  });

  test("WAIT when payout configuration is incomplete", () => {
    expect(assessProjection({ ...clean, payoutConfigured: false }).status).toBe("WAIT");
  });

  test("AVOID on low data quality / extreme volatility / inadequate sample", () => {
    expect(assessProjection({ ...clean, dataQualityScore: 40 }).status).toBe("AVOID");
    expect(assessProjection({ ...clean, volatilityScore: 95 }).status).toBe("AVOID");
    expect(assessProjection({ ...clean, sampleSizeAdequate: false }).status).toBe("AVOID");
    expect(assessProjection({ ...clean, ambiguousMapping: true }).status).toBe("AVOID");
  });

  test("UNAVAILABLE when player/game/market unresolved", () => {
    expect(assessProjection({ ...clean, playerResolved: false }).status).toBe("UNAVAILABLE");
    expect(assessProjection({ ...clean, gameResolved: false }).status).toBe("UNAVAILABLE");
    expect(assessProjection({ ...clean, marketMapped: false }).status).toBe("UNAVAILABLE");
  });

  test("high probability alone is not REVIEW when confidence is low", () => {
    const a = assessProjection({ ...clean, confidenceScore: 60 });
    expect(a.status).toBe("WAIT");
  });

  test("a post-event snapshot is not research-eligible", () => {
    expect(assessProjection({ ...clean, snapshotBeforeEvent: false }).status).toBe("AVOID");
  });
});
