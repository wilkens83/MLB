/* ============================================================================
   Simulation engine — Monte Carlo over the projected distribution to produce a
   full probability distribution, over/under probabilities against a line,
   confidence intervals, and (with a price) EV / edge / Kelly.
   ========================================================================== */

import {
  mulberry32,
  seedFromString,
  samplePoisson,
  sampleNegBinom,
  gaussian,
  poissonCdf,
  poissonPmf,
  negBinomPmf,
  normalCdf,
  quantile,
  mean as arrMean,
  stdDev as arrStdDev,
  type Rng,
} from "@/lib/math/stats";
import type { DistFamily } from "@/lib/props/catalog";
import type { Projection } from "./projection";
import { expectedValue, edge as oddsEdge, kelly, americanToImplied } from "@/lib/odds/math";
import { clamp, round } from "@/lib/utils";

export interface SimulationConfig {
  iterations?: number;
  seed?: string;
  /** Standard deviation to use for the "normal" family when not derivable. */
  normalSigma?: number;
}

export interface DistributionBucket {
  value: number;
  probability: number;
}

export interface SimulationResult {
  iterations: number;
  mean: number;
  median: number;
  stdDev: number;
  /** P(X > line) — the "over" probability, half-push handled for integer lines. */
  probOver: number;
  probUnder: number;
  /** Probability mass exactly on the line (integer lines only). */
  probPush: number;
  line: number;
  /** 80% central credible interval [p10, p90]. */
  ci80: [number, number];
  /** 95% central credible interval [p2.5, p97.5]. */
  ci95: [number, number];
  /** Discrete probability distribution for charting. */
  distribution: DistributionBucket[];
  family: DistFamily;
}

function drawSample(family: DistFamily, proj: Projection, rng: Rng, sigma: number): number {
  switch (family) {
    case "poisson":
      return samplePoisson(proj.lambda, rng);
    case "negbinom":
      return sampleNegBinom(proj.lambda, proj.dispersion ?? 20, rng);
    case "bernoulli":
      return rng() < clamp(proj.lambda, 0, 1) ? 1 : 0;
    case "normal":
      return Math.max(0, proj.lambda + gaussian(rng) * sigma);
  }
}

/**
 * Run the Monte Carlo simulation. For discrete count families we also compute
 * the analytic over/under probability from the closed-form CDF and average it
 * with the empirical estimate for stability at the tails.
 */
export function simulate(
  proj: Projection,
  line: number,
  config: SimulationConfig = {},
): SimulationResult {
  const iterations = config.iterations ?? 10000;
  const rng = mulberry32(seedFromString(config.seed ?? `${proj.lambda}:${line}:${iterations}`));
  const sigma = config.normalSigma ?? Math.max(1, Math.sqrt(Math.max(proj.lambda, 1)) * 1.3);

  const samples = new Float64Array(iterations);
  let over = 0;
  let push = 0;
  const counts = new Map<number, number>();

  for (let i = 0; i < iterations; i++) {
    const s = drawSample(proj.family, proj, rng, sigma);
    samples[i] = s;
    if (s > line) over++;
    else if (s === line) push++;
    if (proj.family !== "normal") {
      counts.set(s, (counts.get(s) ?? 0) + 1);
    }
  }

  const arr = Array.from(samples);
  const empiricalOver = over / iterations;

  // Blend with analytic CDF for discrete families (integer support).
  let probOver = empiricalOver;
  if (proj.family === "poisson" || proj.family === "negbinom") {
    const k = Math.floor(line);
    const cdfAtK =
      proj.family === "poisson"
        ? poissonCdf(k, proj.lambda)
        : negBinomCdf(k, proj.lambda, proj.dispersion ?? 20);
    const analyticOver = 1 - cdfAtK; // P(X > k) for X >= k+1
    probOver = 0.5 * empiricalOver + 0.5 * analyticOver;
  } else if (proj.family === "bernoulli") {
    probOver = line < 1 ? clamp(proj.lambda, 0, 1) : 0;
  } else if (proj.family === "normal") {
    probOver = 1 - normalCdf(line, proj.lambda, sigma);
  }
  probOver = clamp(probOver, 0, 1);

  // Build distribution buckets for charting.
  let distribution: DistributionBucket[];
  if (proj.family === "normal") {
    distribution = histogram(arr, 16);
  } else {
    const maxK = Math.max(...counts.keys(), Math.ceil(line) + 1);
    distribution = [];
    for (let k = 0; k <= maxK; k++) {
      const analytic =
        proj.family === "poisson"
          ? poissonPmf(k, proj.lambda)
          : negBinomPmf(k, proj.lambda, proj.dispersion ?? 20);
      const empirical = (counts.get(k) ?? 0) / iterations;
      distribution.push({ value: k, probability: round(0.5 * analytic + 0.5 * empirical, 4) });
    }
  }

  return {
    iterations,
    mean: round(arrMean(arr), 3),
    median: round(quantile(arr, 0.5), 3),
    stdDev: round(arrStdDev(arr), 3),
    probOver: round(probOver, 4),
    probUnder: round(1 - probOver - push / iterations, 4),
    probPush: round(push / iterations, 4),
    line,
    ci80: [round(quantile(arr, 0.1), 2), round(quantile(arr, 0.9), 2)],
    ci95: [round(quantile(arr, 0.025), 2), round(quantile(arr, 0.975), 2)],
    distribution,
    family: proj.family,
  };
}

function negBinomCdf(k: number, mu: number, size: number): number {
  let sum = 0;
  for (let i = 0; i <= Math.floor(k); i++) sum += negBinomPmf(i, mu, size);
  return Math.min(1, sum);
}

function histogram(xs: number[], bins: number): DistributionBucket[] {
  if (xs.length === 0) return [];
  const min = Math.min(...xs);
  const max = Math.max(...xs);
  const width = (max - min) / bins || 1;
  const buckets = new Array(bins).fill(0);
  for (const x of xs) {
    const idx = clamp(Math.floor((x - min) / width), 0, bins - 1);
    buckets[idx]++;
  }
  return buckets.map((count, i) => ({
    value: round(min + width * (i + 0.5), 2),
    probability: round(count / xs.length, 4),
  }));
}

/* ---------------------------------------------------------------------------
   Betting recommendation — combines simulation output with a market price.
   ------------------------------------------------------------------------- */

export type Recommendation = "strong-over" | "over" | "pass" | "under" | "strong-under";

export interface PropEdge {
  side: "over" | "under";
  modelProb: number;
  impliedProb: number;
  edge: number;
  ev: number;
  kellyFraction: number;
  fairAmerican: number;
}

export interface PropRecommendation {
  recommendation: Recommendation;
  /** 0..100 confidence blended from edge magnitude and sample size. */
  confidence: number;
  over?: PropEdge;
  under?: PropEdge;
  best?: PropEdge;
}

function buildEdge(
  side: "over" | "under",
  modelProb: number,
  american: number,
): PropEdge {
  return {
    side,
    modelProb: round(modelProb, 4),
    impliedProb: round(americanToImplied(american), 4),
    edge: round(oddsEdge(modelProb, american), 4),
    ev: round(expectedValue(modelProb, american), 4),
    kellyFraction: round(kelly(modelProb, american, 0.25), 4), // quarter-Kelly default
    fairAmerican: Math.round(fairPrice(modelProb)),
  };
}

function fairPrice(p: number): number {
  if (p <= 0) return 100000;
  if (p >= 1) return -100000;
  const dec = 1 / p;
  return dec >= 2 ? (dec - 1) * 100 : -100 / (dec - 1);
}

export interface RecommendationInput {
  sim: SimulationResult;
  overAmerican?: number;
  underAmerican?: number;
  sampleSize: number;
}

export function recommend(input: RecommendationInput): PropRecommendation {
  const { sim, overAmerican, underAmerican, sampleSize } = input;
  const over = overAmerican !== undefined ? buildEdge("over", sim.probOver, overAmerican) : undefined;
  const under =
    underAmerican !== undefined ? buildEdge("under", sim.probUnder, underAmerican) : undefined;

  const candidates = [over, under].filter(Boolean) as PropEdge[];
  const best = candidates.length
    ? candidates.reduce((a, b) => (a.ev > b.ev ? a : b))
    : undefined;

  // Sample-size confidence factor: ramps from ~0.4 at n=3 to ~1 at n>=25.
  const sampleFactor = clamp(0.4 + 0.6 * (1 - Math.exp(-sampleSize / 12)), 0.4, 1);
  const edgeMag = best ? Math.abs(best.edge) : Math.abs(sim.probOver - 0.5);
  const confidence = clamp(round(100 * sampleFactor * (0.35 + Math.min(edgeMag * 4, 0.65)), 0), 0, 100);

  let recommendation: Recommendation = "pass";
  if (best && best.ev > 0.0) {
    const strong = best.ev >= 0.08 && confidence >= 60;
    if (best.side === "over") recommendation = strong ? "strong-over" : "over";
    else recommendation = strong ? "strong-under" : "under";
  }

  return { recommendation, confidence, over, under, best };
}
