/* ============================================================================
   Opportunity Engine. Answers: "does this verified line contain enough VERIFIED
   evidence to be actionable?" It REUSES the decision veto/gate engine
   (`computeLegGates`/`evaluateLeg`) for status + scientific vetoes, and adds the
   opportunity-specific rules on top:

     - the DECISION probability is the CALIBRATED probability, never the raw one;
     - if calibration is unavailable, the line can never be QUALIFIED (degrades
       to WATCH) — the raw probability is NOT substituted as "validated";
     - modelAdvantage = calibratedProbability − INDEPENDENT baseline (a league
       prior, never the model itself); a non-positive edge cannot QUALIFY;
     - scientific vetoes are server-derived here and cannot be client-overridden.

   Pure: given assembled facts it is deterministic and side-effect free.
   ========================================================================== */

import { DEFAULT_DECISION_POLICY } from "../decision/policy";
import { computeLegGates, type LegFacts } from "../decision/veto";
import type { DecisionPolicy, MarketValidationState } from "../decision/types";
import type { CalibrationModel } from "./calibration";
import { independentBaseline, baselineForSide } from "./baselines";
import {
  canonicalOpportunityAssessmentSchema, type CanonicalOpportunityAssessment, type OpportunityStatus,
} from "./types";

/** Everything the engine needs, assembled by the graph from real facts. */
export interface OpportunityInput {
  lineSnapshotId: string;
  playerId?: number;
  gamePk?: number;
  market: string; // canonical market key
  line: number;
  isPitcher: boolean;

  // projection (raw, from the existing Monte-Carlo engine)
  rawProbabilityMore: number;
  rawProbabilityLess: number;
  rawProbabilityPush: number;
  projectionMean: number;
  projectionMedian: number;
  dataQuality: number; // 0..100
  volatility: number; // 0..100

  // robustness (from the fragility sweep / simulation CI)
  fragility: number; // 0..100
  worstCaseSelectedProbability?: number;
  uncertaintyLow: number;
  uncertaintyHigh: number;
  trainingSupport: number; // 0..1 (1 = fully inside training support)

  // sensitivity/fragility detail (from runFragilityAnalysis) — all optional
  fragilityLevel?: "LOW" | "MODERATE" | "HIGH" | "EXTREME";
  scenarioProbabilities?: { label: string; assumption: string; probability: number }[];
  probabilityRange?: number;
  medianScenarioProbability?: number;
  directionFlipCount?: number;
  /** Preferred side is not robust under plausible scenarios ⇒ must not qualify. */
  directionUnstable?: boolean;

  // separated prediction-uncertainty sources
  monteCarloStdError?: number;
  modelInputUncertainty?: number;
  dataMissingness?: number;

  // calibration
  calibration: CalibrationModel;

  // trusted scientific facts (server-derived; never client)
  marketValidationState: MarketValidationState;
  calibrationDegraded: boolean;
  featureDriftExceeded: boolean;
  outsideTrainingSupport: boolean;
  requiredSimDependencyUnavailable: boolean;

  // resolution / timing / status
  playerResolved: boolean;
  gameResolved: boolean;
  doubleheaderAmbiguous?: boolean;
  marketSupported: boolean;
  invalidLine?: boolean;
  lineupRequired: boolean;
  lineupConfirmed: boolean;
  pitcherMateriallyRelevant: boolean;
  starterConfirmed: boolean;
  lineAgeMinutes?: number;
  gameStarted: boolean;
  snapshotBeforeEvent: boolean;
  featureCutoffBeforeStart: boolean;
  pregameSnapshotExists: boolean;
  modelVersionApproved: boolean;

  // provenance
  modelVersion: string;
  featureVersion: string;
}

const MIN_MODEL_ADVANTAGE = 0.0; // must beat the independent baseline to qualify

export function assessOpportunity(
  input: OpportunityInput,
  policy: DecisionPolicy = DEFAULT_DECISION_POLICY,
): CanonicalOpportunityAssessment {
  const reasonCodes: string[] = [];
  const cal = input.calibration;

  // 1) Calibrated probabilities are DISTINCT from raw. Never substitute raw as
  //    validated: when calibration is unavailable we leave calibrated undefined.
  const calMore = cal.available ? cal.apply(input.rawProbabilityMore) : undefined;
  const calLess = cal.available ? cal.apply(input.rawProbabilityLess) : undefined;
  if (!cal.available) reasonCodes.push("CALIBRATION_UNAVAILABLE");

  // 2) Decision probability = calibrated when available, else raw (but a raw-only
  //    line can never qualify — see the status downgrade below).
  const decMore = calMore ?? input.rawProbabilityMore;
  const decLess = calLess ?? input.rawProbabilityLess;
  const side: "more" | "less" = decMore >= decLess ? "more" : "less";
  const selected = Math.max(decMore, decLess);

  // 3) Independent baseline + model advantage (never the model vs itself).
  const baseline = independentBaseline(input.market, input.line);
  const baselineProb = baselineForSide(baseline, side);
  const modelAdvantage = cal.available && baselineProb !== undefined ? selected - baselineProb : undefined;

  // 4) Reuse the decision gate/veto engine for status + scientific vetoes.
  const facts: LegFacts = {
    playerId: input.playerId, gamePk: input.gamePk, market: input.market, line: input.line, isPitcher: input.isPitcher,
    playerResolved: input.playerResolved, gameResolved: input.gameResolved,
    doubleheaderAmbiguous: input.doubleheaderAmbiguous, marketSupported: input.marketSupported, invalidLine: input.invalidLine,
    probabilitiesAvailable: Number.isFinite(input.rawProbabilityMore) && Number.isFinite(input.rawProbabilityLess),
    probabilityMore: decMore, probabilityLess: decLess, probabilityPush: input.rawProbabilityPush,
    dataQualityScore: input.dataQuality, volatilityScore: input.volatility, fragilityScore: input.fragility,
    worstCaseSelectedProbability: input.worstCaseSelectedProbability,
    lineupRequired: input.lineupRequired, lineupConfirmed: input.lineupConfirmed,
    pitcherMateriallyRelevant: input.pitcherMateriallyRelevant, starterConfirmed: input.starterConfirmed,
    lineAgeMinutes: input.lineAgeMinutes, gameStarted: input.gameStarted,
    snapshotBeforeEvent: input.snapshotBeforeEvent, featureCutoffBeforeStart: input.featureCutoffBeforeStart,
    pregameSnapshotExists: input.pregameSnapshotExists, modelVersionApproved: input.modelVersionApproved,
    marketValidationState: input.marketValidationState,
    calibrationDegraded: input.calibrationDegraded, featureDriftExceeded: input.featureDriftExceeded,
    outsideTrainingSupport: input.outsideTrainingSupport, requiredSimDependencyUnavailable: input.requiredSimDependencyUnavailable,
  };
  const gates = computeLegGates(facts, policy);
  const scientificVetoes = gates.vetoes.map((v) => ({ code: v.code, message: v.message }));

  // 5) Map gate classes to opportunity status (precedence: UNAVAILABLE > WATCH > NO_PLAY > QUALIFIED).
  let status: OpportunityStatus;
  if (gates.unavailable.length > 0) {
    status = "UNAVAILABLE";
    reasonCodes.push(...gates.unavailable.map((r) => r.code));
  } else if (gates.wait.length > 0) {
    status = "WATCH";
    reasonCodes.push(...gates.wait.map((r) => r.code));
  } else {
    // Soft/hard rejections → NO_PLAY.
    const softMiss: string[] = [];
    if (selected < policy.minimumSelectedSideProbability) softMiss.push("PROBABILITY_BELOW_MIN");
    if (input.dataQuality < policy.minimumDataQuality) softMiss.push("DATA_QUALITY_BELOW_MIN");
    if (input.fragility > policy.maximumFragility) softMiss.push("FRAGILITY_ABOVE_MAX");
    if (policy.maximumVolatility !== undefined && input.volatility > policy.maximumVolatility) softMiss.push("VOLATILITY_ABOVE_MAX");
    if (input.worstCaseSelectedProbability !== undefined && input.worstCaseSelectedProbability < policy.minimumSelectedSideProbability) softMiss.push("SENSITIVITY_WORST_CASE");
    // Critical rule: plausible scenarios repeatedly crossing 50% / reversing the
    // preferred side ⇒ the direction is not robust ⇒ do NOT qualify.
    if (input.directionUnstable) softMiss.push("DIRECTION_UNSTABLE");

    if (gates.noBet.length > 0 || softMiss.length > 0) {
      status = "NO_PLAY";
      reasonCodes.push(...gates.noBet.map((r) => r.code), ...softMiss);
    } else if (!cal.available) {
      // Passes every gate but has no trustworthy calibration ⇒ WATCH (never QUALIFIED).
      status = "WATCH";
    } else if (baselineProb === undefined) {
      status = "WATCH";
      reasonCodes.push("BASELINE_UNAVAILABLE");
    } else if (modelAdvantage === undefined || modelAdvantage <= MIN_MODEL_ADVANTAGE) {
      status = "NO_PLAY";
      reasonCodes.push("NO_EDGE_VS_BASELINE");
    } else {
      status = side === "more" ? "QUALIFIED_MORE" : "QUALIFIED_LESS";
      reasonCodes.push("OPPORTUNITY_QUALIFIED");
    }
  }

  return canonicalOpportunityAssessmentSchema.parse({
    lineSnapshotId: input.lineSnapshotId,
    playerId: input.playerId, gamePk: input.gamePk, market: input.market, line: input.line,
    side: status === "QUALIFIED_MORE" ? "more" : status === "QUALIFIED_LESS" ? "less" : side,
    rawProbabilityMore: input.rawProbabilityMore, rawProbabilityLess: input.rawProbabilityLess, rawProbabilityPush: input.rawProbabilityPush,
    calibratedProbabilityMore: calMore, calibratedProbabilityLess: calLess, calibrationAvailable: cal.available,
    projectionMean: input.projectionMean, projectionMedian: input.projectionMedian,
    baselineProbability: baselineProb, modelAdvantage,
    uncertaintyLow: input.uncertaintyLow, uncertaintyHigh: input.uncertaintyHigh,
    dataQuality: input.dataQuality, trainingSupport: input.trainingSupport,
    modelLifecycleState: input.marketValidationState, fragility: input.fragility, volatility: input.volatility,
    fragilityLevel: input.fragilityLevel,
    scenarioProbabilities: input.scenarioProbabilities,
    probabilityRange: input.probabilityRange,
    medianScenarioProbability: input.medianScenarioProbability,
    directionFlipCount: input.directionFlipCount,
    directionUnstable: input.directionUnstable,
    monteCarloStdError: input.monteCarloStdError,
    modelInputUncertainty: input.modelInputUncertainty,
    dataMissingness: input.dataMissingness,
    lineupStatus: input.lineupRequired ? (input.lineupConfirmed ? "confirmed" : "projected") : "not_required",
    starterStatus: input.pitcherMateriallyRelevant ? (input.starterConfirmed ? "confirmed" : "projected") : "not_relevant",
    dataFreshness: input.lineAgeMinutes === undefined ? "unknown" : input.lineAgeMinutes > policy.maximumLineAgeMinutes ? "stale" : "fresh",
    scientificVetoes,
    status,
    reasonCodes: [...new Set(reasonCodes)],
    generatedAt: new Date().toISOString(),
    modelVersion: input.modelVersion,
    calibrationVersion: cal.version,
    featureVersion: input.featureVersion,
  });
}
