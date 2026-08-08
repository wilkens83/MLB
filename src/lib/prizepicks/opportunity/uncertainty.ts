/* ============================================================================
   Prediction uncertainty — deliberately kept as THREE DISTINCT, separately
   explained sources, never collapsed into one meaningless "confidence" number:

     1. Monte-Carlo uncertainty  — sampling noise from a finite simulation
        (shrinks as iterations grow; nothing to do with the world).
     2. Model / input uncertainty — how much the probability moves under
        plausible changes to the assumptions (from the fragility sweep).
     3. Data missingness          — the fraction of expected inputs that are
        absent (a data-completeness gap, NOT a probability and NOT "confidence").

   A caller that wants a headline number must combine these EXPLICITLY and own the
   interpretation; this module never hides the decomposition.
   ========================================================================== */

export interface PredictionUncertainty {
  /** Standard error of the simulated win probability (sampling noise). */
  monteCarloStdError: number;
  /** 95% Monte-Carlo half-width (≈1.96·SE) around the point estimate. */
  monteCarloHalfWidth95: number;
  /** Half the plausible-assumption probability range (input/model uncertainty). */
  modelInputUncertainty: number;
  /** Fraction of expected inputs missing (0 = complete, 1 = nothing). */
  dataMissingness: number;
  /** Human-readable notes so the three are never confused for one another. */
  explanation: {
    monteCarlo: string;
    modelInput: string;
    dataMissingness: string;
  };
}

const clampUnit = (n: number) => Math.min(1, Math.max(0, n));

/** Monte-Carlo standard error of a proportion from N iterations. */
export function monteCarloStdError(probability: number, iterations: number): number {
  const p = clampUnit(probability);
  if (iterations <= 0) return 0.5;
  return Math.sqrt((p * (1 - p)) / iterations);
}

export interface UncertaintyInput {
  probability: number;
  iterations: number;
  /** Plausible-assumption probability range (from the fragility sweep). */
  probabilityRange: number;
  /** Fraction of expected inputs present, 0..1 (data COMPLETENESS, not quality). */
  dataCompleteness: number;
}

/** Assemble the separated prediction-uncertainty decomposition. */
export function predictionUncertainty(input: UncertaintyInput): PredictionUncertainty {
  const se = monteCarloStdError(input.probability, input.iterations);
  const modelInput = Math.max(0, input.probabilityRange) / 2;
  const dataMissingness = clampUnit(1 - clampUnit(input.dataCompleteness));
  return {
    monteCarloStdError: round(se),
    monteCarloHalfWidth95: round(1.96 * se),
    modelInputUncertainty: round(modelInput),
    dataMissingness: round(dataMissingness),
    explanation: {
      monteCarlo: `±${round(1.96 * se)} from finite simulation (${input.iterations} iters); shrinks with more iterations.`,
      modelInput: `±${round(modelInput)} from plausible changes to the assumptions (fragility sweep).`,
      dataMissingness: `${Math.round(dataMissingness * 100)}% of expected inputs are missing — a completeness gap, not a probability.`,
    },
  };
}

const round = (x: number) => Math.round(x * 1000) / 1000;
