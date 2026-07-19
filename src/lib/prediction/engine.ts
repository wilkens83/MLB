/* ============================================================================
   Prediction engine facade — the single entry point that turns a stat series
   + prop + line (+ optional market prices and context) into a complete,
   UI-ready analysis: projection, Monte Carlo distribution, hit-rate history,
   and a betting recommendation.
   ========================================================================== */

import { getProp, type PropDef } from "@/lib/props/catalog";
import { project, type ContextAdjustments } from "./projection";
import { simulate, recommend, type SimulationResult, type PropRecommendation } from "./simulate";
import { analyzeStat, type StatAnalytics, type Side } from "@/lib/analytics/hitRate";

export interface AnalyzePropInput {
  propKey: string;
  series: number[];
  line?: number;
  side?: Side;
  overAmerican?: number;
  underAmerican?: number;
  context?: ContextAdjustments;
  priorMean?: number;
  iterations?: number;
  seed?: string;
}

export interface PropAnalysis {
  prop: PropDef;
  line: number;
  side: Side;
  projection: ReturnType<typeof project>;
  simulation: SimulationResult;
  analytics: StatAnalytics;
  recommendation: PropRecommendation;
}

export function analyzeProp(input: AnalyzePropInput): PropAnalysis {
  const prop = getProp(input.propKey);
  if (!prop) throw new Error(`Unknown prop: ${input.propKey}`);

  const line = input.line ?? prop.defaultLine;
  const side = input.side ?? "over";

  const projection = project({
    series: input.series,
    family: prop.family,
    priorMean: input.priorMean,
    context: input.context,
  });

  const simulation = simulate(projection, line, {
    iterations: input.iterations ?? 10000,
    seed: input.seed ?? `${prop.key}:${line}`,
  });

  const analytics = analyzeStat(input.series, line, side);

  const recommendation = recommend({
    sim: simulation,
    overAmerican: input.overAmerican,
    underAmerican: input.underAmerican,
    sampleSize: input.series.length,
  });

  return { prop, line, side, projection, simulation, analytics, recommendation };
}
