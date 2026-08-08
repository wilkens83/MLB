import { describe, it, expect } from "bun:test";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import {
  summarizeFragility, runFragilityAnalysis, hitterPerturbations, pitcherPerturbations,
  DEFAULT_FRAGILITY_CONFIG, type ScenarioProbability,
} from "./fragility";
import { predictionUncertainty, monteCarloStdError } from "./uncertainty";
import { modelConfidenceLabel, dataCompletenessLabel } from "./labels";
import { assessOpportunity, type OpportunityInput } from "./engine";

const sc = (label: string, probability: number): ScenarioProbability => ({ label, assumption: label, probability });

describe("fragility summarizer", () => {
  it("wider scenario spread ⇒ wider probability range (more input uncertainty widens output)", () => {
    const narrow = summarizeFragility(0.70, [sc("a", 0.69), sc("b", 0.71), sc("c", 0.70)]);
    const wide = summarizeFragility(0.70, [sc("a", 0.55), sc("b", 0.85), sc("c", 0.62)]);
    expect(wide.probabilityRange).toBeGreaterThan(narrow.probabilityRange);
    expect(wide.fragilityScore).toBeGreaterThan(narrow.fragilityScore);
  });

  it("direction flips raise fragility and are counted", () => {
    const stable = summarizeFragility(0.70, [sc("a", 0.66), sc("b", 0.72)]);
    const flipping = summarizeFragility(0.55, [sc("a", 0.44), sc("b", 0.47), sc("c", 0.58)]); // two cross below 0.5
    expect(flipping.directionFlipCount).toBe(2);
    expect(flipping.fragilityScore).toBeGreaterThan(stable.fragilityScore);
    expect(flipping.directionUnstable).toBe(true); // ≥ maxDirectionFlips
  });

  it("assigns fragility levels from CONFIGURABLE thresholds (not hard-coded truth)", () => {
    // A modest range (0.04 → score 20) reads differently under different configs.
    const scenarios = [sc("a", 0.68), sc("b", 0.72)];
    const strict = summarizeFragility(0.70, scenarios, { ...DEFAULT_FRAGILITY_CONFIG, moderateAt: 10, highAt: 20, extremeAt: 30 });
    expect(strict.fragilityLevel).toBe("HIGH"); // 20 ≥ highAt(20)
    const lenient = summarizeFragility(0.70, scenarios, DEFAULT_FRAGILITY_CONFIG);
    expect(lenient.fragilityLevel).toBe("LOW"); // 20 < moderateAt(25)
  });

  it("does NOT invent weather perturbations when weather is unavailable", () => {
    expect(hitterPerturbations(false).some((p) => p.assumption === "weather")).toBe(false);
    expect(hitterPerturbations(true).some((p) => p.assumption === "weather")).toBe(true);
    expect(pitcherPerturbations(false).some((p) => p.assumption === "weather")).toBe(false);
  });

  it("uses hitter- and pitcher-specific assumption axes", () => {
    const h = hitterPerturbations().map((p) => p.assumption);
    expect(h).toEqual(expect.arrayContaining(["expected_pa", "lineup_slot", "start_probability", "opposing_pitcher", "park_factor", "recent_form"]));
    const p = pitcherPerturbations().map((x) => x.assumption);
    expect(p).toEqual(expect.arrayContaining(["expected_bf", "pitch_count", "removal_hazard", "opponent_k_profile", "recent_workload", "manager_hook"]));
  });
});

describe("sim-backed fragility is deterministic under a fixed seed", () => {
  const input = {
    kind: "pitcher" as const, market: "strikeouts", line: 5.5, direction: "more" as const,
    rates: { k: 0.28, bb: 0.07, hbp: 0.01, single: 0.14, double: 0.04, triple: 0.004, hr: 0.03, out: 0.426 },
    expected: 24, iterations: 2000, seed: "seed-xyz",
  };
  it("reproduces the same result for the same seed", () => {
    const a = runFragilityAnalysis(input);
    const b = runFragilityAnalysis(input);
    expect(a).toEqual(b);
  });
  it("produces one scenario per configured perturbation", () => {
    const a = runFragilityAnalysis(input);
    expect(a.scenarioProbabilities.length).toBe(pitcherPerturbations(false).length);
  });
});

describe("prediction uncertainty is decomposed, never one number", () => {
  it("keeps Monte-Carlo error, model/input uncertainty and data missingness separate", () => {
    const u = predictionUncertainty({ probability: 0.7, iterations: 10_000, probabilityRange: 0.2, dataCompleteness: 0.8 });
    expect(u.monteCarloStdError).toBeGreaterThan(0);
    expect(u.modelInputUncertainty).toBeCloseTo(0.1, 6); // half the 0.2 range
    expect(u.dataMissingness).toBeCloseTo(0.2, 6); // 1 - 0.8 completeness
    // three distinct explanations exist
    expect(Object.keys(u.explanation).sort()).toEqual(["dataMissingness", "modelInput", "monteCarlo"]);
  });
  it("Monte-Carlo error shrinks as iterations grow", () => {
    expect(monteCarloStdError(0.7, 1000)).toBeGreaterThan(monteCarloStdError(0.7, 100_000));
  });
});

describe("Data Quality and probability stay separate concepts", () => {
  it("labels never conflate a score with a probability/certainty", () => {
    expect(modelConfidenceLabel(85)).toBe("Model Confidence 85/100");
    expect(modelConfidenceLabel(85)).not.toContain("%");
    expect(dataCompletenessLabel(1)).toBe("Data Completeness: 100%");
    // Data completeness is a percent of inputs present — NOT "100% confidence".
    expect(dataCompletenessLabel(1)).not.toContain("confidence");
  });
});

describe("UI does not display ambiguous '100% confidence' wording", () => {
  const files = [
    "src/components/prop/recommendation-card.tsx",
    "src/components/analyze/analysis-workspace.tsx",
  ];
  it("no component renders a '% confidence' string", () => {
    for (const f of files) {
      const text = readFileSync(join(process.cwd(), f), "utf8");
      expect(/%\s*confidence/i.test(text)).toBe(false);
      expect(text.includes("100% confidence")).toBe(false);
    }
  });
});

describe("Opportunity Engine — direction instability blocks qualification", () => {
  function base(over: Partial<OpportunityInput> = {}): OpportunityInput {
    return {
      lineSnapshotId: "l1", playerId: 1, gamePk: 2, market: "strikeouts", line: 5.5, isPitcher: true,
      rawProbabilityMore: 0.75, rawProbabilityLess: 0.24, rawProbabilityPush: 0.01,
      projectionMean: 6.3, projectionMedian: 6, dataQuality: 90, volatility: 20,
      fragility: 20, worstCaseSelectedProbability: 0.66, uncertaintyLow: 0.62, uncertaintyHigh: 0.82, trainingSupport: 1,
      calibration: { available: true, version: "c", sampleSize: 500, apply: (r) => r * 0.9 },
      marketValidationState: "VALIDATED", calibrationDegraded: false, featureDriftExceeded: false,
      outsideTrainingSupport: false, requiredSimDependencyUnavailable: false,
      playerResolved: true, gameResolved: true, marketSupported: true,
      lineupRequired: false, lineupConfirmed: false, pitcherMateriallyRelevant: true, starterConfirmed: true,
      lineAgeMinutes: 5, gameStarted: false, snapshotBeforeEvent: true, featureCutoffBeforeStart: true,
      pregameSnapshotExists: true, modelVersionApproved: true, modelVersion: "m", featureVersion: "f",
      ...over,
    };
  }
  it("a direction-unstable line is never QUALIFIED", () => {
    const stable = assessOpportunity(base({ directionUnstable: false }));
    expect(stable.status).toBe("QUALIFIED_MORE");
    const unstable = assessOpportunity(base({ directionUnstable: true, directionFlipCount: 3, fragilityLevel: "EXTREME" }));
    expect(unstable.status).toBe("NO_PLAY");
    expect(unstable.reasonCodes).toContain("DIRECTION_UNSTABLE");
  });
});
