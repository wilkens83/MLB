/* ============================================================================
   Postgame grading — turn a point-in-time prediction + the official actual value
   into a canonical PredictionGrade. Reuses `clearsLine` (the same over/under
   semantics the analytics layer uses) and the Brier/log-loss math; it does NOT
   re-derive any prop stat formula — the actual value comes from the canonical
   prop-extraction layer (`extractPropSeries`).
   ========================================================================== */

import { clearsLine } from "@/lib/analytics/hitRate";

export interface PredictionGrade {
  predictionId: string;
  actualValue: number;
  result: "win" | "loss" | "push";
  /** 1 when the OVER hit, 0 when it did not. Undefined on a push. */
  overOutcome: 0 | 1 | undefined;
  /** The model's probability for the OVER side. */
  predictedProbability: number;
  squaredError: number; // Brier contribution (NaN on push)
  logLoss: number; // clamped (NaN on push)
  absoluteProjectionError: number;
  gradedAt: number;
  resultSource: string;
}

const clampP = (p: number) => Math.min(1 - 1e-9, Math.max(1e-9, p));

/**
 * Grade a single OVER prediction against the actual value. A push (actual exactly
 * on an integer line) is excluded from Brier/log-loss (returns NaN there) but the
 * projection error is always computed.
 */
export function gradePrediction(input: {
  predictionId: string;
  line: number;
  probOver: number;
  projection: number;
  actualValue: number;
  resultSource?: string;
  gradedAt?: number;
}): PredictionGrade {
  const { predictionId, line, probOver, projection, actualValue } = input;
  const cleared = clearsLine(actualValue, line, "over"); // true=over, false=under, null=push
  const overOutcome: 0 | 1 | undefined = cleared === null ? undefined : cleared ? 1 : 0;
  const result: PredictionGrade["result"] = cleared === null ? "push" : cleared ? "win" : "loss";

  const p = clampP(probOver);
  const y = overOutcome;
  const squaredError = y === undefined ? NaN : (p - y) ** 2;
  const logLoss = y === undefined ? NaN : -(y * Math.log(p) + (1 - y) * Math.log(1 - p));

  return {
    predictionId,
    actualValue,
    result,
    overOutcome,
    predictedProbability: probOver,
    squaredError,
    logLoss,
    absoluteProjectionError: Math.abs(projection - actualValue),
    gradedAt: input.gradedAt ?? Date.now(),
    resultSource: input.resultSource ?? "mlb-stats-api",
  };
}
