/* ============================================================================
   computeModelEnsemble — assemble the parallel deterministic models for one prop
   and combine them. It REUSES the already-computed simulations from the analysis
   pipeline (the marginal Monte-Carlo and, when applicable, the plate-appearance
   structural simulation) and adds the baseline control model, then blends and
   measures disagreement. No projection is recomputed by an LLM; this is pure.
   ========================================================================== */

import type { SimulationResult } from "@/lib/prediction/simulate";
import type { DistFamily } from "@/lib/props/catalog";
import { baselineModel } from "./baseline";
import { buildEnsemble } from "./ensemble";
import { computeDisagreement } from "./disagreement";
import type { ModelOutput, ModelEnsembleResult } from "./types";

function fromSimulation(id: "marginal" | "pa", sim: SimulationResult, sampleSize: number, modelVersion: string, meta: Record<string, unknown> = {}): ModelOutput {
  return {
    id,
    modelVersion,
    projection: round3(sim.mean),
    probOver: sim.probOver,
    probUnder: sim.probUnder,
    probPush: sim.probPush,
    distribution: sim.distribution,
    sampleSize,
    warnings: sampleSize < 5 ? [`${id}: small sample (${sampleSize} games)`] : [],
    metadata: { iterations: sim.iterations, median: sim.median, ...meta },
  };
}

/**
 * Build models (marginal, optional PA, baseline) → ensemble → disagreement.
 * `marginalSim` is required (Model A). `paSim` is supplied only for PA-modeled
 * batter props (Model B). The baseline (Model C) is computed here as the control.
 */
export function computeModelEnsemble(args: {
  series: number[];
  family: DistFamily;
  line: number;
  seed: string;
  marginalSim: SimulationResult;
  paSim?: SimulationResult;
  /** Engine model version for the reused sims (passed in to avoid an import cycle). */
  modelVersion: string;
}): ModelEnsembleResult {
  const { series, family, line, seed, marginalSim, paSim, modelVersion } = args;
  const sampleSize = series.length;

  const models: ModelOutput[] = [];
  // Model B (plate-appearance structural) — first so it leads when present.
  if (paSim) models.push(fromSimulation("pa", paSim, sampleSize, modelVersion, { structural: true }));
  // Model A (marginal Monte-Carlo).
  models.push(fromSimulation("marginal", marginalSim, sampleSize, modelVersion));
  // Model C (baseline control).
  models.push(baselineModel({ series, family, line, seed }));

  const ensemble = buildEnsemble(models);
  const disagreement = computeDisagreement(models);
  return { models, ensemble, disagreement };
}

function round3(x: number): number { return Math.round(x * 1000) / 1000; }
