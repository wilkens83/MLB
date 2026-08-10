/* ============================================================================
   Model disagreement — a DETERMINISTIC measure of how far the present models'
   probabilities/projections spread. High disagreement is a signal to lower
   reliability, widen warnings, and weaken recommendation strength; it never
   silently changes the projection. Thresholds are configurable constants.
   ========================================================================== */

import type { ModelOutput, ModelDisagreement, DisagreementSeverity } from "./types";

export interface DisagreementThresholds {
  /** probOver range at/above which severity is at least medium. */
  mediumRange: number;
  /** probOver range at/above which severity is high. */
  highRange: number;
}

export const DEFAULT_DISAGREEMENT_THRESHOLDS: DisagreementThresholds = {
  mediumRange: 0.08,
  highRange: 0.15,
};

export function computeDisagreement(
  models: ModelOutput[],
  thresholds: DisagreementThresholds = DEFAULT_DISAGREEMENT_THRESHOLDS,
): ModelDisagreement {
  const probs = models.map((m) => m.probOver);
  const projs = models.map((m) => m.projection);
  if (probs.length < 2) {
    // A single model cannot disagree with itself — report zero spread, low severity.
    return {
      probabilityRange: 0,
      projectionRange: 0,
      stdDevProbability: 0,
      severity: "low",
      modelCount: probs.length,
    };
  }
  const probabilityRange = Math.max(...probs) - Math.min(...probs);
  const projectionRange = Math.max(...projs) - Math.min(...projs);
  const stdDevProbability = populationStdDev(probs);

  const severity: DisagreementSeverity =
    probabilityRange >= thresholds.highRange ? "high"
      : probabilityRange >= thresholds.mediumRange ? "medium" : "low";

  return {
    probabilityRange: round4(probabilityRange),
    projectionRange: round3(projectionRange),
    stdDevProbability: round4(stdDevProbability),
    severity,
    modelCount: probs.length,
  };
}

function populationStdDev(xs: number[]): number {
  const m = xs.reduce((s, x) => s + x, 0) / xs.length;
  const v = xs.reduce((s, x) => s + (x - m) ** 2, 0) / xs.length;
  return Math.sqrt(v);
}
function round3(x: number): number { return Math.round(x * 1000) / 1000; }
function round4(x: number): number { return Math.round(x * 10000) / 10000; }
