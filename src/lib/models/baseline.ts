/* ============================================================================
   Model C — the BASELINE control model. Deliberately simple: a short-half-life
   recency mean with light shrinkage toward the season mean, NO context
   adjustments (park/weather/platoon/form). It exists so the richer marginal and
   plate-appearance models are always measured against a naive control — a model
   that cannot beat this baseline is not adding value.

   Pure + deterministic: reuses `project` + `simulate` (seeded). No new math.
   ========================================================================== */

import { project } from "@/lib/prediction/projection";
import { simulate } from "@/lib/prediction/simulate";
import type { DistFamily } from "@/lib/props/catalog";
import type { ModelOutput } from "./types";

export const BASELINE_MODEL_VERSION = "baseline-1.0.0";

/**
 * Build the baseline ModelOutput for a prop. Uses a short recency half-life and a
 * light prior toward the season mean, and applies NO context multiplier — this is
 * the control. Returns finite, invariant-respecting probabilities.
 */
export function baselineModel(args: {
  series: number[];
  family: DistFamily;
  line: number;
  seed: string;
}): ModelOutput {
  const { series, family, line, seed } = args;
  const warnings: string[] = [];
  if (series.length < 3) warnings.push("baseline: fewer than 3 games — estimate is unstable");

  // Short half-life (recency-heavy) + light shrink to the season mean. No context.
  const projection = project({ series, family, halfLife: 4, priorWeight: 2 });
  const sim = simulate(projection, line, { seed: `${seed}:baseline` });

  return {
    id: "baseline",
    modelVersion: BASELINE_MODEL_VERSION,
    projection: round3(sim.mean),
    probOver: sim.probOver,
    probUnder: sim.probUnder,
    probPush: sim.probPush,
    distribution: sim.distribution,
    sampleSize: series.length,
    warnings,
    metadata: { halfLife: 4, priorWeight: 2, contextApplied: false, lambda: round3(projection.lambda) },
  };
}

function round3(x: number): number {
  return Math.round(x * 1000) / 1000;
}
