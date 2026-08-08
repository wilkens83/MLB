import { describe, it, expect } from "bun:test";
import { rankOpportunities, describeOpportunityRow } from "./query";
import type { CanonicalOpportunityAssessment } from "./types";

function assess(over: Partial<CanonicalOpportunityAssessment> = {}): CanonicalOpportunityAssessment {
  return {
    lineSnapshotId: "l1", playerId: 1, gamePk: 2, market: "strikeouts", line: 5.5, side: "more",
    rawProbabilityMore: 0.75, rawProbabilityLess: 0.24, rawProbabilityPush: 0.01,
    calibratedProbabilityMore: 0.68, calibratedProbabilityLess: 0.31, calibrationAvailable: true,
    projectionMean: 6.3, projectionMedian: 6, baselineProbability: 0.44, modelAdvantage: 0.24,
    uncertaintyLow: 0.62, uncertaintyHigh: 0.82, dataQuality: 90, trainingSupport: 1,
    modelLifecycleState: "VALIDATED", fragility: 20, volatility: 20,
    scientificVetoes: [], status: "QUALIFIED_MORE", reasonCodes: ["OPPORTUNITY_QUALIFIED"],
    generatedAt: "2026-07-21T20:00:00Z", modelVersion: "m9", calibrationVersion: "c1", featureVersion: "f3",
    ...over,
  };
}

describe("rankOpportunities", () => {
  it("returns only QUALIFIED candidates by default (never a fabricated pick)", () => {
    const rows = rankOpportunities([
      assess({ lineSnapshotId: "q", status: "QUALIFIED_MORE" }),
      assess({ lineSnapshotId: "w", status: "WATCH" }),
      assess({ lineSnapshotId: "n", status: "NO_PLAY" }),
    ]);
    expect(rows.map((r) => r.lineSnapshotId)).toEqual(["q"]);
  });

  it("empty input ⇒ no rows", () => {
    expect(rankOpportunities([]).length).toBe(0);
  });

  it("excludes an unvalidated-market (NO_PLAY) line from QUALIFIED", () => {
    const rows = rankOpportunities([assess({ status: "NO_PLAY", reasonCodes: ["MARKET_RESEARCH_ONLY"] })]);
    expect(rows.length).toBe(0);
  });

  it("excludes a stale line (NO_PLAY) from QUALIFIED", () => {
    const rows = rankOpportunities([assess({ status: "NO_PLAY", reasonCodes: ["LINE_STALE"] })]);
    expect(rows.length).toBe(0);
  });

  it("filters by market and side", () => {
    const rows = rankOpportunities([
      assess({ lineSnapshotId: "k", market: "strikeouts" }),
      assess({ lineSnapshotId: "h", market: "hits" }),
    ], { market: "hits" });
    expect(rows.map((r) => r.market)).toEqual(["hits"]);
  });

  it("sorts by advantage, calibrated, or fragility", () => {
    const a = assess({ lineSnapshotId: "a", modelAdvantage: 0.10, calibratedProbabilityMore: 0.66, fragility: 40 });
    const b = assess({ lineSnapshotId: "b", modelAdvantage: 0.30, calibratedProbabilityMore: 0.72, fragility: 10 });
    expect(rankOpportunities([a, b], { sortBy: "advantage" })[0].lineSnapshotId).toBe("b");
    expect(rankOpportunities([a, b], { sortBy: "calibrated" })[0].lineSnapshotId).toBe("b");
    expect(rankOpportunities([a, b], { sortBy: "fragility" })[0].lineSnapshotId).toBe("b"); // lowest fragility first
  });
});

describe("describeOpportunityRow — raw and calibrated are DISTINCT", () => {
  it("keeps raw probability separate and never relabels it calibrated", () => {
    const row = describeOpportunityRow(assess());
    expect(row.rawProbability).toBe(0.75);
    expect(row.calibratedProbability).toBe(0.68);
    expect(row.calibratedProbability).not.toBe(row.rawProbability);
  });

  it("reports calibratedProbability = null when calibration is unavailable (raw NOT substituted)", () => {
    const row = describeOpportunityRow(assess({
      status: "WATCH", calibrationAvailable: false, calibratedProbabilityMore: undefined, calibratedProbabilityLess: undefined,
    }));
    expect(row.calibratedProbability).toBeNull();
    expect(row.rawProbability).toBe(0.75); // still shown, but as RAW
  });

  it("carries the canonical decision + reasons + provenance verbatim", () => {
    const a = assess({ status: "QUALIFIED_MORE", reasonCodes: ["OPPORTUNITY_QUALIFIED", "x", "y"], scientificVetoes: [] });
    const row = describeOpportunityRow(a);
    expect(row.status).toBe("QUALIFIED_MORE");
    expect(row.primaryReasons).toEqual(a.reasonCodes.slice(0, 4));
    expect(row.modelVersion).toBe("m9");
    expect(row.calibrationVersion).toBe("c1");
    expect(row.dataTimestamp).toBe("2026-07-21T20:00:00Z");
  });
});
