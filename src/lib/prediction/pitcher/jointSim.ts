/* ============================================================================
   Joint pitcher-start simulation — the centerpiece. ONE simulated outing yields
   all six correlated props. Each batter faced is drawn from the pitcher's
   allowed per-BF rates (coherent event path — a K is an out and not a hit, a walk
   is not a hit, an HR is a hit), advanced through the shared bases-state run model
   (reused from the entry joint sim), accumulates pitches, and then faces a
   removal hazard that can end the outing early. This encodes the causal feedback
   loop: poor performance → more baserunners/pitches → higher hook risk → fewer
   future opportunities. A market line is applied only AFTER this distribution
   exists (see props.ts). Deterministic under a seed.
   ========================================================================== */

import { mulberry32, seedFromString, gaussian, type Rng } from "@/lib/math/stats";
import { clamp } from "@/lib/utils";
import { sampleOutcome, advance, type BfOutcome } from "@/lib/prizepicks/entry/jointSim";
import { ratesPerBf } from "./rates";
import { buildRemovalParams, removalHazard, type RemovalParams } from "./removal";
import type { WorkloadBudget } from "./workload";
import {
  PITCHER_JOINT_PROPS, PITCHER_SIM_VERSION,
  type DistSummary, type PitcherJointProp, type PitcherJointSimulation, type PitcherRates,
  type PitcherStartOutcome, type PitcherUsageProjection, type PropCorrelation, type VolumeEfficiency,
} from "./types";

const BATTERS_PER_TIME_THROUGH = 9;

/**
 * Hard structural ceiling on outs a STARTER can record in one game: a complete
 * nine-inning game is 27 outs. This is a baseball invariant, not a tuned
 * parameter — no starter records more than 27 outs (modern extra-inning starts
 * are effectively extinct). Without it the removal hazard's tail can run an
 * outing past 9 IP, inflating pitcher_outs / innings exceedance in the far tail.
 */
export const MAX_START_OUTS = 27;

/** Pitches thrown for one batter — event-dependent, jittered around the mean. */
function pitchesForBatter(outcome: BfOutcome, meanPerBf: number, rng: Rng): number {
  // Strikeouts/walks run deep counts; quick outs are cheap. Multipliers around 1.
  const mult = outcome === "k" || outcome === "bb" ? 1.35 : outcome === "out" ? 0.85 : 1.0;
  const base = meanPerBf * mult + gaussian(rng) * 0.8;
  return clamp(Math.round(base), 1, 12);
}

/** Live game state to condition on (all pregame values are 0 / active). */
export interface LiveState {
  pitcherActive: boolean;
  pitches: number;
  battersFaced: number;
  outs: number;
  strikeouts: number;
  hits_allowed: number;
  pitcher_walks: number;
  home_runs_allowed: number;
  earned_runs: number;
}

/**
 * Simulate ONE start from a given already-accumulated state (0 for pregame).
 * Returns the JOINT outcome (final totals incl. any live baseline).
 */
export function simulatePitcherStart(
  rates: PitcherRates,
  workload: WorkloadBudget,
  params: RemovalParams,
  rng: Rng,
  from?: LiveState,
): PitcherStartOutcome {
  const o: PitcherStartOutcome = {
    pitches: from?.pitches ?? 0,
    battersFaced: from?.battersFaced ?? 0,
    outs: from?.outs ?? 0,
    strikeouts: from?.strikeouts ?? 0,
    hits_allowed: from?.hits_allowed ?? 0,
    pitcher_walks: from?.pitcher_walks ?? 0,
    home_runs_allowed: from?.home_runs_allowed ?? 0,
    earned_runs: from?.earned_runs ?? 0,
    timesThroughOrder: 0,
    removedReason: "completed",
  };

  // REMOVED PITCHER INVARIANT: no future accumulation once pulled.
  if (from && from.pitcherActive === false) {
    o.removedReason = "capped";
    o.timesThroughOrder = Math.floor(o.battersFaced / BATTERS_PER_TIME_THROUGH) + (o.battersFaced % BATTERS_PER_TIME_THROUGH > 0 ? 1 : 0);
    return o;
  }

  const bases: [boolean, boolean, boolean] = [false, false, false];
  // Guard against runaway loops; the removal hard-cap normally ends it first.
  const hardBfLimit = params.maxBattersFaced + 2;

  while (o.battersFaced < hardBfLimit) {
    const outcome = sampleOutcome(rates, rng);
    o.pitches += pitchesForBatter(outcome, workload.pitchesPerBf, rng);
    o.battersFaced++;
    switch (outcome) {
      case "k": o.strikeouts++; o.outs++; break;
      case "out": o.outs++; break;
      case "bb": o.pitcher_walks++; o.earned_runs += advance(bases, outcome); break;
      case "hbp": o.earned_runs += advance(bases, outcome); break;
      case "single": o.hits_allowed++; o.earned_runs += advance(bases, outcome); break;
      case "double": o.hits_allowed++; o.earned_runs += advance(bases, outcome); break;
      case "triple": o.hits_allowed++; o.earned_runs += advance(bases, outcome); break;
      case "hr": o.hits_allowed++; o.home_runs_allowed++; o.earned_runs += advance(bases, outcome); break;
    }
    o.timesThroughOrder = Math.floor((o.battersFaced - 1) / BATTERS_PER_TIME_THROUGH) + 1;

    // Structural ceiling: a starter's outing ends at a complete game (27 outs).
    // Enforced before the removal hazard so the tail can never exceed 9 IP.
    if (o.outs >= MAX_START_OUTS) { o.removedReason = "completed"; break; }

    const baserunners = (bases[0] ? 1 : 0) + (bases[1] ? 1 : 0) + (bases[2] ? 1 : 0);
    const { hazard, reason } = removalHazard(
      { pitchCount: o.pitches, battersFaced: o.battersFaced, outs: o.outs, runsAllowed: o.earned_runs, baserunners, timesThroughOrder: o.timesThroughOrder },
      params,
    );
    if (rng() < hazard) { o.removedReason = reason; break; }
  }
  return o;
}

function summarize(samples: number[]): DistSummary {
  const sorted = [...samples].sort((a, b) => a - b);
  const q = (p: number) => sorted[clamp(Math.floor(p * (sorted.length - 1)), 0, sorted.length - 1)];
  const mean = samples.reduce((a, b) => a + b, 0) / (samples.length || 1);
  const variance = samples.reduce((a, b) => a + (b - mean) ** 2, 0) / (samples.length || 1);
  return {
    mean: round3(mean),
    median: round3(q(0.5)),
    stdDev: round3(Math.sqrt(variance)),
    p10: round3(q(0.1)),
    p90: round3(q(0.9)),
  };
}

function pearson(xs: number[], ys: number[]): number {
  const n = xs.length;
  if (n === 0) return 0;
  const mx = xs.reduce((a, b) => a + b, 0) / n;
  const my = ys.reduce((a, b) => a + b, 0) / n;
  let cov = 0, vx = 0, vy = 0;
  for (let i = 0; i < n; i++) { const dx = xs[i] - mx, dy = ys[i] - my; cov += dx * dy; vx += dx * dx; vy += dy * dy; }
  if (vx <= 0 || vy <= 0) return 0;
  return round3(cov / Math.sqrt(vx * vy));
}

export interface PitcherJointInput {
  rates: PitcherRates;
  workload: WorkloadBudget;
  seed: string;
  iterations?: number;
  /** Live game state to condition the REMAINING opportunity on (optional). */
  live?: LiveState;
  removalParams?: RemovalParams;
}

/** Canonical Monte-Carlo iteration count (mirrors the engine's convention). */
export const PITCHER_SIM_ITERATIONS = 10000;

/**
 * Run the joint simulation: N starts → per-prop distributions + retained joint
 * samples + a usage projection + volume/efficiency + pairwise correlations.
 * Deterministic: same rates/workload/seed/live ⇒ identical result.
 */
export function runPitcherJointSimulation(input: PitcherJointInput): PitcherJointSimulation {
  const iterations = input.iterations ?? PITCHER_SIM_ITERATIONS;
  const rng = mulberry32(seedFromString(input.seed));
  const params = input.removalParams ?? buildRemovalParams(input.workload.targetPitches);

  const samples: Record<PitcherJointProp, number[]> = {
    strikeouts: [], pitcher_outs: [], earned_runs: [], hits_allowed: [], pitcher_walks: [], home_runs_allowed: [],
  };
  const pitchesArr: number[] = [];
  const bfArr: number[] = [];
  const hookPitchAtRemoval: number[] = [];
  const hookReasonCounts = { pitchCount: 0, performance: 0, capped: 0 };
  let before6 = 0;

  for (let i = 0; i < iterations; i++) {
    const start = simulatePitcherStart(input.rates, input.workload, params, rng, input.live);
    samples.strikeouts.push(start.strikeouts);
    samples.pitcher_outs.push(start.outs);
    samples.earned_runs.push(start.earned_runs);
    samples.hits_allowed.push(start.hits_allowed);
    samples.pitcher_walks.push(start.pitcher_walks);
    samples.home_runs_allowed.push(start.home_runs_allowed);
    pitchesArr.push(start.pitches);
    bfArr.push(start.battersFaced);
    if (start.outs < 18) before6++;
    if (start.removedReason !== "completed") {
      hookPitchAtRemoval.push(start.pitches);
      hookReasonCounts[start.removedReason]++;
    }
  }

  const outsSummary = summarize(samples.pitcher_outs);
  const exceed = (arr: number[], k: number) => round4(arr.filter((v) => v >= k).length / arr.length);

  const usage: PitcherUsageProjection = {
    expectedPitches: round2(mean(pitchesArr)),
    expectedBattersFaced: round2(mean(bfArr)),
    expectedOuts: round2(outsSummary.mean),
    expectedInnings: round2(outsSummary.mean / 3),
    pitches: summarize(pitchesArr),
    battersFaced: summarize(bfArr),
    outs: outsSummary,
    outsExceedance: { p15: exceed(samples.pitcher_outs, 15), p18: exceed(samples.pitcher_outs, 18), p21: exceed(samples.pitcher_outs, 21) },
    inningsExceedance: { ip5: exceed(samples.pitcher_outs, 15), ip6: exceed(samples.pitcher_outs, 18), ip7: exceed(samples.pitcher_outs, 21) },
    removalRisk: {
      pBefore6IP: round4(before6 / iterations),
      meanHookPitchCount: hookPitchAtRemoval.length ? round2(mean(hookPitchAtRemoval)) : 0,
      hookReason: {
        pitchCount: round4(hookReasonCounts.pitchCount / iterations),
        performance: round4(hookReasonCounts.performance / iterations),
        capped: round4(hookReasonCounts.capped / iterations),
      },
    },
    provenance: input.workload.provenance,
  };

  const pbf = ratesPerBf(input.rates);
  const volumeEfficiency: VolumeEfficiency = {
    expectedBattersFaced: usage.expectedBattersFaced,
    expectedPitches: usage.expectedPitches,
    expectedOuts: usage.expectedOuts,
    rates: { kPerBf: round4(pbf.kPerBf), bbPerBf: round4(pbf.bbPerBf), hPerBf: round4(pbf.hPerBf), hrPerBf: round4(pbf.hrPerBf) },
  };

  const summary = {} as Record<PitcherJointProp, DistSummary>;
  for (const p of PITCHER_JOINT_PROPS) summary[p] = summarize(samples[p]);

  // Pairwise correlations from the JOINT samples (never from marginals).
  const correlations: PropCorrelation[] = [];
  for (let i = 0; i < PITCHER_JOINT_PROPS.length; i++) {
    for (let j = i + 1; j < PITCHER_JOINT_PROPS.length; j++) {
      const a = PITCHER_JOINT_PROPS[i], b = PITCHER_JOINT_PROPS[j];
      correlations.push({ a, b, pearson: pearson(samples[a], samples[b]) });
    }
  }

  return {
    version: PITCHER_SIM_VERSION,
    seed: input.seed,
    iterations,
    usage,
    volumeEfficiency,
    samples,
    summary,
    correlations,
    liveBaseline: input.live
      ? {
          strikeouts: input.live.strikeouts, pitcher_outs: input.live.outs, earned_runs: input.live.earned_runs,
          hits_allowed: input.live.hits_allowed, pitcher_walks: input.live.pitcher_walks, home_runs_allowed: input.live.home_runs_allowed,
        }
      : undefined,
    generatedAt: Date.now(),
  };
}

function mean(a: number[]): number { return a.reduce((x, y) => x + y, 0) / (a.length || 1); }
function round2(n: number): number { return Math.round(n * 100) / 100; }
function round3(n: number): number { return Math.round(n * 1000) / 1000; }
function round4(n: number): number { return Math.round(n * 10000) / 10000; }
