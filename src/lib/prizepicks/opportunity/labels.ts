/* ============================================================================
   Canonical UI labels for the distinct uncertainty concepts. The point is that
   these are DIFFERENT things and must never be collapsed into "confidence" or
   shown as "100% confidence" (which reads as certainty of the outcome).
   ========================================================================== */

export const UNCERTAINTY_LABELS = {
  dataCompleteness: "Data Completeness",
  modelConfidence: "Model Confidence",
  calibrationSupport: "Calibration Support",
  probabilityRange: "Probability Range",
  monteCarloError: "Monte-Carlo Error",
  modelInputUncertainty: "Model / Input Uncertainty",
  dataMissingness: "Data Missingness",
} as const;

/** Model-signal strength as a 0–100 SCORE — never "N% confidence" (certainty). */
export function modelConfidenceLabel(score: number): string {
  return `${UNCERTAINTY_LABELS.modelConfidence} ${Math.round(score)}/100`;
}

/** Data completeness as a percent of expected inputs present (NOT a probability). */
export function dataCompletenessLabel(fraction0to1: number): string {
  return `${UNCERTAINTY_LABELS.dataCompleteness}: ${Math.round(Math.min(1, Math.max(0, fraction0to1)) * 100)}%`;
}
