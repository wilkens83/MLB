import { describe, it, expect } from "bun:test";
import { assessOpportunity, type OpportunityInput } from "./engine";
import { unavailableCalibration, fitCalibration, type CalibrationModel } from "./calibration";
import { independentBaseline } from "./baselines";
import { InMemoryOpportunityStore } from "./store";

/** A calibration model that is available and NON-identity (0.9× shrink). */
const shrinkCalibration: CalibrationModel = {
  available: true, version: "cal-test-1", sampleSize: 500, apply: (r) => Math.min(1, Math.max(0, r * 0.9)),
};

/** A fully-valid input that QUALIFIES as MORE unless a field is perturbed. */
function baseInput(over: Partial<OpportunityInput> = {}): OpportunityInput {
  return {
    lineSnapshotId: "2026-07-21|paul skenes|strikeouts",
    playerId: 694973, gamePk: 776001, market: "strikeouts", line: 5.5, isPitcher: true,
    rawProbabilityMore: 0.75, rawProbabilityLess: 0.24, rawProbabilityPush: 0.01,
    projectionMean: 6.3, projectionMedian: 6, dataQuality: 90, volatility: 20,
    fragility: 20, worstCaseSelectedProbability: 0.66, uncertaintyLow: 0.62, uncertaintyHigh: 0.82, trainingSupport: 1,
    calibration: shrinkCalibration,
    marketValidationState: "VALIDATED", calibrationDegraded: false, featureDriftExceeded: false,
    outsideTrainingSupport: false, requiredSimDependencyUnavailable: false,
    playerResolved: true, gameResolved: true, marketSupported: true,
    lineupRequired: false, lineupConfirmed: false, pitcherMateriallyRelevant: true, starterConfirmed: true,
    lineAgeMinutes: 5, gameStarted: false, snapshotBeforeEvent: true, featureCutoffBeforeStart: true,
    pregameSnapshotExists: true, modelVersionApproved: true,
    modelVersion: "mlb-model-9", featureVersion: "feat-3",
    ...over,
  };
}

describe("Opportunity Engine", () => {
  it("QUALIFIES a clean line as MORE and keeps raw ≠ calibrated", () => {
    const a = assessOpportunity(baseInput());
    expect(a.status).toBe("QUALIFIED_MORE");
    // raw and calibrated are DISTINCT
    expect(a.calibratedProbabilityMore).toBeDefined();
    expect(a.calibratedProbabilityMore).not.toBe(a.rawProbabilityMore);
    expect(a.calibratedProbabilityMore).toBeCloseTo(0.675, 3);
    expect(a.calibrationAvailable).toBe(true);
  });

  it("unavailable calibration can NEVER produce QUALIFIED (degrades to WATCH)", () => {
    const a = assessOpportunity(baseInput({ calibration: unavailableCalibration() }));
    expect(a.status).toBe("WATCH");
    expect(a.calibratedProbabilityMore).toBeUndefined(); // raw never substituted as validated
    expect(a.reasonCodes).toContain("CALIBRATION_UNAVAILABLE");
  });

  it("an unvalidated model can NEVER produce QUALIFIED", () => {
    const a = assessOpportunity(baseInput({ marketValidationState: "RESEARCH_ONLY" }));
    expect(a.status).toBe("NO_PLAY");
    expect(a.scientificVetoes.some((v) => v.code.includes("RESEARCH") || v.code.includes("NOT_ELIGIBLE"))).toBe(true);
  });

  it("poor data quality can NEVER produce QUALIFIED", () => {
    const a = assessOpportunity(baseInput({ dataQuality: 40 }));
    expect(a.status).toBe("NO_PLAY");
    expect(a.scientificVetoes.some((v) => v.code === "DATA_QUALITY_FLOOR")).toBe(true);
  });

  it("high fragility blocks qualification", () => {
    const a = assessOpportunity(baseInput({ fragility: 70 }));
    expect(a.status).toBe("NO_PLAY");
    expect(a.scientificVetoes.some((v) => v.code === "FRAGILITY_CEILING")).toBe(true);
  });

  it("a stale line blocks qualification", () => {
    const a = assessOpportunity(baseInput({ lineAgeMinutes: 45 }));
    expect(a.status).toBe("NO_PLAY");
    expect(a.dataFreshness).toBe("stale");
    expect(a.scientificVetoes.some((v) => v.code === "LINE_STALE")).toBe(true);
  });

  it("model advantage is measured against an INDEPENDENT baseline (not the model itself)", () => {
    const a = assessOpportunity(baseInput());
    // The baseline is the league-prior probability — computed with no model input.
    const expectedBaseline = independentBaseline("strikeouts", 5.5).probabilityMore!;
    expect(a.baselineProbability).toBeCloseTo(expectedBaseline, 6);
    expect(a.baselineProbability).not.toBe(a.calibratedProbabilityMore); // independent, not self
    expect(a.modelAdvantage).toBeCloseTo(a.calibratedProbabilityMore! - expectedBaseline, 6);
    expect(a.modelAdvantage!).toBeGreaterThan(0);
  });

  it("no edge over the independent baseline cannot QUALIFY", () => {
    // Calibrated ≈ 0.70 clears the probability floor, but the total_bases 0.5
    // league baseline (~0.765) is HIGHER → negative edge → NO_PLAY.
    const a = assessOpportunity(baseInput({
      rawProbabilityMore: 0.778, rawProbabilityLess: 0.212,
      calibration: { available: true, version: "c", sampleSize: 300, apply: (r) => r * 0.9 },
      market: "total_bases", line: 0.5, isPitcher: false, worstCaseSelectedProbability: 0.66,
    }));
    expect(a.status).toBe("NO_PLAY");
    expect(a.reasonCodes).toContain("NO_EDGE_VS_BASELINE");
    expect(a.modelAdvantage!).toBeLessThanOrEqual(0);
  });

  it("scientific vetoes are engine-derived and cannot be overridden by input flags", () => {
    // There is no input that can flip a vetoed line to QUALIFIED — a circuit
    // breaker forces NO_PLAY regardless of an otherwise-perfect line.
    const a = assessOpportunity(baseInput({ featureDriftExceeded: true }));
    expect(a.status).toBe("NO_PLAY");
    expect(a.scientificVetoes.some((v) => v.code === "CIRCUIT_BREAKER")).toBe(true);
  });

  it("fitCalibration returns UNAVAILABLE on thin evidence (never a silent identity)", () => {
    const thin = fitCalibration([{ bucket: "0.6-0.7", n: 5, predicted: 0.65, observed: 0.6 }], { version: "c" });
    expect(thin.available).toBe(false);
  });

  it("persists an assessment that references the exact line/model/calibration/feature versions", async () => {
    const store = new InMemoryOpportunityStore();
    const a = assessOpportunity(baseInput());
    const rec = await store.persist(a);
    expect(rec.assessment.lineSnapshotId).toBe("2026-07-21|paul skenes|strikeouts");
    expect(rec.assessment.modelVersion).toBe("mlb-model-9");
    expect(rec.assessment.calibrationVersion).toBe("cal-test-1");
    expect(rec.assessment.featureVersion).toBe("feat-3");
    // Immutable: a second assessment is a NEW record, not an overwrite.
    await store.persist(assessOpportunity(baseInput({ modelVersion: "mlb-model-10" })));
    const hist = await store.history("2026-07-21|paul skenes|strikeouts");
    expect(hist.length).toBe(2);
    expect(hist.map((h) => h.assessment.modelVersion)).toEqual(["mlb-model-9", "mlb-model-10"]);
  });
});
