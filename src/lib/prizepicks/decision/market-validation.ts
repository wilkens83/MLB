/* ============================================================================
   Market validation gate. Uses archived FORWARD results (from the backtest
   metrics engine) to decide whether a market/model-version may drive firm BET
   decisions. Unit tests passing is NOT validation — predictive quality is.

   - RESEARCH_ONLY: too few graded results → analysis only, BET prohibited.
   - PROVISIONAL: enough sample but not yet strong calibration → BET only under
     stricter settings.
   - VALIDATED: adequate sample + acceptable calibration → normal policy.
   - SUSPENDED: calibration/drift failure → BET prohibited.
   ========================================================================== */

import type { MarketValidationState } from "./types";

export interface MarketValidationInput {
  gradedCount: number;
  brierScore?: number;
  logLoss?: number;
  /** |predicted − observed| averaged over calibration buckets (0..1). */
  calibrationError?: number;
  /** Set true when live monitoring detects drift/degradation. */
  driftDetected?: boolean;
  minimumForwardSample?: number;
}

export interface MarketValidationConfig {
  minimumForwardSample: number;
  validatedSample: number;
  maxBrierValidated: number;
  maxBrierProvisional: number;
  maxCalibrationErrorValidated: number;
}

export const DEFAULT_VALIDATION_CONFIG: MarketValidationConfig = {
  minimumForwardSample: 100,
  validatedSample: 300,
  maxBrierValidated: 0.23,
  maxBrierProvisional: 0.25,
  maxCalibrationErrorValidated: 0.06,
};

export function deriveMarketValidationState(
  input: MarketValidationInput,
  config: MarketValidationConfig = DEFAULT_VALIDATION_CONFIG,
): { state: MarketValidationState; reason: string } {
  if (input.driftDetected) return { state: "SUSPENDED", reason: "Drift/calibration degradation detected in live monitoring." };
  const minSample = input.minimumForwardSample ?? config.minimumForwardSample;
  if (input.gradedCount < minSample) {
    return { state: "RESEARCH_ONLY", reason: `Only ${input.gradedCount} graded forward results (< ${minSample}).` };
  }
  const brier = input.brierScore;
  if (brier !== undefined && brier > config.maxBrierProvisional) {
    return { state: "SUSPENDED", reason: `Brier ${brier} exceeds the provisional ceiling ${config.maxBrierProvisional}.` };
  }
  const calibrated =
    (brier === undefined || brier <= config.maxBrierValidated) &&
    (input.calibrationError === undefined || input.calibrationError <= config.maxCalibrationErrorValidated);
  if (input.gradedCount >= config.validatedSample && calibrated) {
    return { state: "VALIDATED", reason: `${input.gradedCount} graded results with acceptable calibration.` };
  }
  return { state: "PROVISIONAL", reason: `${input.gradedCount} graded results; calibration not yet strong enough to validate.` };
}
