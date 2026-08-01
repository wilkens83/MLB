/* ============================================================================
   Projection assessment policy. Keeps probability, confidence, data quality,
   volatility and fragility as SEPARATE dimensions — a high model probability is
   never on its own a recommendation. Produces a research status (REVIEW / WAIT /
   AVOID / NO_EDGE / UNAVAILABLE) with explicit reasons and warnings.

   These are RESEARCH thresholds, not proven-profitability thresholds. Nothing
   here is a lock, guarantee or edge claim.
   ========================================================================== */

export type AssessmentStatus = "REVIEW" | "WAIT" | "AVOID" | "NO_EDGE" | "UNAVAILABLE";

export interface AssessmentInput {
  probabilityMore: number;
  probabilityLess: number;
  probabilityPush?: number;
  confidenceScore: number; // 0..100
  dataQualityScore: number; // 0..100
  volatilityScore: number; // 0..100 (higher = more volatile)
  fragilityScore: number; // 0..100 (higher = more sensitive to assumptions)
  // Context flags
  playerResolved: boolean;
  gameResolved: boolean;
  marketMapped: boolean;
  snapshotBeforeEvent: boolean;
  lineupConfirmed: boolean;
  starterConfirmed: boolean;
  roleUncertain?: boolean;
  lineStale?: boolean;
  weatherMaterialButMissing?: boolean;
  payoutConfigured?: boolean;
  sampleSizeAdequate: boolean;
  ambiguousMapping?: boolean;
  providerConflict?: boolean;
  probabilitiesAvailable?: boolean;
}

export interface ProjectionAssessment {
  probabilityMore: number;
  probabilityLess: number;
  probabilityPush: number;
  directionalProbability: number;
  confidenceScore: number;
  dataQualityScore: number;
  volatilityScore: number;
  fragilityScore: number;
  status: AssessmentStatus;
  reasons: string[];
  warnings: string[];
}

/** Research eligibility thresholds (NOT profitability thresholds). */
export const ASSESSMENT_THRESHOLDS = {
  minDirectionalProbability: 0.58,
  minConfidence: 70,
  minDataQuality: 75,
  avoidDataQualityBelow: 50,
  extremeVolatilityAbove: 85,
  excessiveFragilityAbove: 80,
} as const;

export function assessProjection(input: AssessmentInput): ProjectionAssessment {
  const reasons: string[] = [];
  const warnings: string[] = [];
  const T = ASSESSMENT_THRESHOLDS;
  const probPush = input.probabilityPush ?? 0;
  const directional = Math.max(input.probabilityMore, input.probabilityLess);

  const base = {
    probabilityMore: input.probabilityMore,
    probabilityLess: input.probabilityLess,
    probabilityPush: probPush,
    directionalProbability: directional,
    confidenceScore: input.confidenceScore,
    dataQualityScore: input.dataQualityScore,
    volatilityScore: input.volatilityScore,
    fragilityScore: input.fragilityScore,
  };

  const finalize = (status: AssessmentStatus): ProjectionAssessment => ({ ...base, status, reasons, warnings });

  // 1. UNAVAILABLE — cannot assess safely.
  if (input.probabilitiesAvailable === false) reasons.push("No probability distribution available.");
  if (!input.playerResolved) reasons.push("Player not resolved to an MLBAM id.");
  if (!input.gameResolved) reasons.push("Game / doubleheader not resolved.");
  if (!input.marketMapped) reasons.push("Market not mapped to a supported prop (sent to review).");
  if (reasons.length > 0) return finalize("UNAVAILABLE");

  // 2. AVOID — hard blocks on data integrity.
  if (input.dataQualityScore < T.avoidDataQualityBelow) reasons.push(`Data quality ${input.dataQualityScore} below ${T.avoidDataQualityBelow}.`);
  if (input.volatilityScore > T.extremeVolatilityAbove) reasons.push(`Extreme volatility (${input.volatilityScore}).`);
  if (input.fragilityScore > T.excessiveFragilityAbove) reasons.push(`Excessive sensitivity to assumptions (fragility ${input.fragilityScore}).`);
  if (!input.sampleSizeAdequate) reasons.push("Inadequate effective sample size.");
  if (input.ambiguousMapping) reasons.push("Ambiguous player / doubleheader mapping.");
  if (input.providerConflict) reasons.push("Unresolved provider conflict.");
  if (reasons.length > 0) return finalize("AVOID");

  // 3. WAIT — resolvable-but-not-yet conditions.
  if (!input.lineupConfirmed) warnings.push("Lineup is projected, not confirmed.");
  if (!input.starterConfirmed) warnings.push("Probable pitcher not confirmed.");
  if (input.roleUncertain) warnings.push("Player role is uncertain.");
  if (input.lineStale) warnings.push("Imported line may be stale.");
  if (input.weatherMaterialButMissing) warnings.push("Weather materially affects this projection but is unavailable.");
  if (input.payoutConfigured === false) warnings.push("Payout configuration incomplete — economic EV withheld.");
  if (warnings.length > 0) {
    reasons.push("One or more conditions require confirmation before review.");
    return finalize("WAIT");
  }

  // 4. NO_EDGE — clean data, but not enough probability advantage vs 50%.
  if (directional < T.minDirectionalProbability) {
    reasons.push(`Directional probability ${directional.toFixed(3)} below the ${T.minDirectionalProbability} research threshold.`);
    return finalize("NO_EDGE");
  }

  // 5. Below confidence/quality bars but not a hard AVOID → WAIT for better data.
  if (input.confidenceScore < T.minConfidence || input.dataQualityScore < T.minDataQuality) {
    if (input.confidenceScore < T.minConfidence) warnings.push(`Confidence ${input.confidenceScore} below ${T.minConfidence}.`);
    if (input.dataQualityScore < T.minDataQuality) warnings.push(`Data quality ${input.dataQualityScore} below ${T.minDataQuality}.`);
    reasons.push("Meets probability bar but not the confidence/data-quality bars.");
    return finalize("WAIT");
  }

  // 6. REVIEW — eligible for human research (not a recommendation, not a lock).
  if (!input.snapshotBeforeEvent) {
    reasons.push("Snapshot was not created before the event; excluded from research eligibility.");
    return finalize("AVOID");
  }
  reasons.push("Meets research thresholds (probability, confidence, data quality) — eligible for review, not a recommendation.");
  return finalize("REVIEW");
}
