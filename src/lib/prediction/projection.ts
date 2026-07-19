/* ============================================================================
   Projection engine — estimates the expected value (rate parameter) for a prop
   from a player's game history, applying recency weighting, Bayesian shrinkage
   toward a population prior, and multiplicative context adjustments
   (opponent, park, weather, handedness, rest).
   ========================================================================== */

import { mean, ewma, stdDev } from "@/lib/math/stats";
import { clamp } from "@/lib/utils";
import type { DistFamily } from "@/lib/props/catalog";

export interface ContextAdjustments {
  /** Opponent strength multiplier (1 = neutral, >1 favors the bettor's stat). */
  opponent?: number;
  /** Ballpark factor for the stat (e.g. Coors ~1.35 for hits/runs). */
  park?: number;
  /** Weather/temperature multiplier (hot air carries the ball → HR up). */
  weather?: number;
  /** Platoon/handedness multiplier (batter vs L/R pitcher). */
  handedness?: number;
  /** Rest/fatigue multiplier. */
  rest?: number;
  /** Projected role/usage multiplier (e.g. pitcher pitch-count leash). */
  usage?: number;
}

export interface ProjectionInput {
  series: number[]; // oldest → newest per-game values of the stat
  family: DistFamily;
  /** Population/positional prior mean for shrinkage. If omitted, uses series mean. */
  priorMean?: number;
  /** Strength of the prior in "pseudo-games". Higher = more regression. */
  priorWeight?: number;
  /** Recency half-life in games for the exponential weighting. */
  halfLife?: number;
  context?: ContextAdjustments;
}

export interface Projection {
  /** Modeled expected value (mean) for the game — the rate parameter. */
  lambda: number;
  /** Raw recency-weighted mean before shrinkage/context. */
  recentMean: number;
  /** Blended mean after Bayesian shrinkage. */
  shrunkMean: number;
  /** Combined context multiplier that was applied. */
  contextMultiplier: number;
  /** Dispersion parameter (for negbinom); undefined otherwise. */
  dispersion?: number;
  /** Effective sample size behind the estimate. */
  sampleSize: number;
  family: DistFamily;
}

function combinedContext(ctx?: ContextAdjustments): number {
  if (!ctx) return 1;
  const parts = [ctx.opponent, ctx.park, ctx.weather, ctx.handedness, ctx.rest, ctx.usage];
  let m = 1;
  for (const p of parts) if (typeof p === "number" && Number.isFinite(p)) m *= p;
  // Guard against pathological stacking of extreme factors.
  return clamp(m, 0.4, 2.5);
}

/** Convert a half-life (in games) to the EWMA alpha smoothing factor. */
function alphaFromHalfLife(halfLife: number): number {
  return 1 - Math.exp(-Math.LN2 / Math.max(1, halfLife));
}

/**
 * Estimate the negative-binomial dispersion (size = r) from the sample using a
 * method-of-moments fit: Var = mu + mu^2 / r. Falls back to a large r (≈Poisson)
 * when the data are underdispersed.
 */
function estimateDispersion(series: number[], mu: number): number {
  if (series.length < 3 || mu <= 0) return 50;
  const v = stdDev(series) ** 2;
  if (v <= mu) return 50; // underdispersed → effectively Poisson
  const r = (mu * mu) / (v - mu);
  return clamp(r, 1, 100);
}

export function project(input: ProjectionInput): Projection {
  const { series, family } = input;
  const n = series.length;
  const halfLife = input.halfLife ?? 12;
  const alpha = alphaFromHalfLife(halfLife);

  const recentMean = n > 0 ? ewma(series, alpha) : (input.priorMean ?? 0);
  const priorMean = input.priorMean ?? (n > 0 ? mean(series) : 0);
  const priorWeight = input.priorWeight ?? 4;

  // Bayesian shrinkage: blend the observed recency mean with the prior in
  // proportion to sample size vs prior strength.
  const shrunkMean = (recentMean * n + priorMean * priorWeight) / (n + priorWeight);

  const contextMultiplier = combinedContext(input.context);
  const lambda = Math.max(0, shrunkMean * contextMultiplier);

  const dispersion =
    family === "negbinom" ? estimateDispersion(series, Math.max(lambda, 0.01)) : undefined;

  return {
    lambda,
    recentMean,
    shrunkMean,
    contextMultiplier,
    dispersion,
    sampleSize: n,
    family,
  };
}
