/* ============================================================================
   Ensemble — a simple, explainable, versioned weighted average of the present
   models' probabilities. NOT opaque ML: weights are configurable constants,
   renormalized over the models that are actually present (a missing model is
   never fabricated). Individual contributions are preserved for transparency.
   ========================================================================== */

import {
  MODEL_WEIGHTS, MODEL_ENSEMBLE_VERSION,
  type ModelOutput, type ModelId, type EnsembleOutput, type EnsembleContribution,
} from "./types";

/**
 * Blend present models into one probability + projection. Weights come from the
 * versioned MODEL_WEIGHTS and are renormalized over the present models so they
 * always sum to 1. Push probability is carried as the weighted mean and the
 * three probabilities are renormalized to sum to 1 (invariant).
 */
export function buildEnsemble(models: ModelOutput[]): EnsembleOutput {
  const warnings: string[] = [];
  if (models.length === 0) {
    return {
      rawProbOver: 0, rawProbUnder: 0, rawProbPush: 0, projection: 0,
      weights: {}, contributions: [], version: MODEL_ENSEMBLE_VERSION,
      warnings: ["ensemble: no models available"],
    };
  }

  // Effective weights: renormalize the configured weights over present models.
  const rawWeightSum = models.reduce((s, m) => s + (MODEL_WEIGHTS[m.id] ?? 0), 0);
  const weights: Partial<Record<ModelId, number>> = {};
  const effWeight = (id: ModelId): number =>
    rawWeightSum > 0 ? (MODEL_WEIGHTS[id] ?? 0) / rawWeightSum : 1 / models.length;

  let over = 0;
  let under = 0;
  let push = 0;
  let projection = 0;
  const contributions: EnsembleContribution[] = [];
  for (const m of models) {
    const w = effWeight(m.id);
    weights[m.id] = round4(w);
    over += w * m.probOver;
    under += w * m.probUnder;
    push += w * m.probPush;
    projection += w * m.projection;
    contributions.push({ id: m.id, weight: round4(w), probOver: m.probOver, projection: m.projection });
  }

  // Renormalize the three probabilities to sum to exactly 1 (guards drift).
  const total = over + under + push;
  if (total > 0) {
    over /= total;
    under /= total;
    push /= total;
  } else {
    warnings.push("ensemble: degenerate probabilities");
  }

  if (models.length === 1) warnings.push(`ensemble: only the ${models[0].id} model was available`);

  return {
    rawProbOver: round4(over),
    rawProbUnder: round4(under),
    rawProbPush: round4(push),
    projection: round3(projection),
    weights,
    contributions,
    version: MODEL_ENSEMBLE_VERSION,
    warnings,
  };
}

function round3(x: number): number { return Math.round(x * 1000) / 1000; }
function round4(x: number): number { return Math.round(x * 10000) / 10000; }
