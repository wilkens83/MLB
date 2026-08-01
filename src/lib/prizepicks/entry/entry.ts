/* ============================================================================
   Correlation-aware entry analysis. Evaluates a COMPLETE PrizePicks entry
   (Power or Flex) rather than isolated legs:

   - simulates each player-game jointly (same-unit legs are correlated),
   - derives each leg's win probability from the joint samples,
   - builds the entry outcome distribution P(exactly k correct) from the joint
     samples (never by multiplying marginals when joint samples exist),
   - detects correlations + contradictions between legs,
   - applies a configurable Power/Flex payout table for expected payout.

   Deterministic given a seed. Every number is simulated, never fabricated;
   unsupported markets (e.g. runs/RBIs, which need baserunner state) are flagged.
   ========================================================================== */

import type { PaRates } from "@/lib/prediction/paSim";
import { simulateHitterGame, simulatePitcherGame, unitRng } from "./jointSim";
import { analyzeCorrelations, type CorrelationPair, type LegRef } from "./correlation";
import { defaultPayoutTable, expectedPayout, type EntryType, type PayoutTable } from "./payout";

export type LegDirection = "more" | "less";

export interface HitterModel {
  kind: "hitter";
  rates: PaRates;
  expectedPa: number;
}
export interface PitcherModel {
  kind: "pitcher";
  /** Per-batter-faced outcome rates the pitcher ALLOWS. */
  allowedRates: PaRates;
  expectedBF: number;
}
export type LegModel = HitterModel | PitcherModel;

export interface EntryLegInput {
  id: string;
  label: string;
  playerId: number;
  gamePk?: number;
  market: string;
  direction: LegDirection;
  line: number;
  model: LegModel;
}

export interface EntryAnalysisInput {
  legs: EntryLegInput[];
  entryType: EntryType;
  iterations?: number;
  seed?: string;
  payoutTable?: PayoutTable;
}

const HITTER_FIELDS: Record<string, keyof import("./jointSim").HitterGameOutcome> = {
  hits: "hits",
  total_bases: "total_bases",
  home_runs: "home_runs",
  singles: "singles",
  doubles: "doubles",
  triples: "triples",
  walks: "walks",
  batter_strikeouts: "batter_strikeouts",
};
const PITCHER_FIELDS: Record<string, keyof import("./jointSim").PitcherGameOutcome> = {
  strikeouts: "strikeouts",
  pitcher_outs: "pitcher_outs",
  hits_allowed: "hits_allowed",
  pitcher_walks: "pitcher_walks",
  home_runs_allowed: "home_runs_allowed",
  earned_runs: "earned_runs",
};

export interface EntryLegResult {
  id: string;
  label: string;
  market: string;
  direction: LegDirection;
  line: number;
  probWin: number;
  probPush: number;
  supported: boolean;
}

export interface EntryAnalysis {
  entryType: EntryType;
  size: number;
  iterations: number;
  legs: EntryLegResult[];
  /** distribution[k] = P(exactly k legs win). Length = size + 1. */
  distribution: number[];
  correlations: CorrelationPair[];
  contradictions: CorrelationPair[];
  payout: { table: string; ev: number; breakdown: { correct: number; probability: number; multiplier: number }[] };
  /** P(all legs win) — the Power condition. */
  probAllWin: number;
  /** Expalue-neutral variance proxy: std dev of correct-count. */
  correctCountStdDev: number;
  warnings: string[];
}

function unitKey(leg: EntryLegInput): string {
  return `${leg.playerId}:${leg.gamePk ?? "na"}`;
}

export function analyzeEntry(input: EntryAnalysisInput): EntryAnalysis {
  const iterations = input.iterations ?? 10000;
  const legs = input.legs;
  const size = legs.length;
  const warnings: string[] = [];

  // Group legs by player-game so same-unit legs share one simulated game per iter.
  const units = new Map<string, EntryLegInput[]>();
  for (const leg of legs) {
    const key = unitKey(leg);
    (units.get(key) ?? units.set(key, []).get(key)!).push(leg);
  }

  const indicators: Record<string, number[]> = {};
  const winCounts: Record<string, number> = {};
  const pushCounts: Record<string, number> = {};
  const supported: Record<string, boolean> = {};
  for (const leg of legs) {
    indicators[leg.id] = new Array(iterations).fill(0);
    winCounts[leg.id] = 0;
    pushCounts[leg.id] = 0;
    supported[leg.id] = leg.model.kind === "hitter" ? !!HITTER_FIELDS[leg.market] : !!PITCHER_FIELDS[leg.market];
    if (!supported[leg.id]) {
      warnings.push(`Market "${leg.market}" is not modeled by the joint simulator (needs baserunner/lineup state); excluded from the entry distribution.`);
    }
  }

  const correctPerIter = new Array(iterations).fill(0);

  for (let iter = 0; iter < iterations; iter++) {
    for (const [key, unitLegs] of units) {
      // One RNG stream per unit per iteration → same-unit legs are jointly drawn.
      const rng = unitRng(`${input.seed ?? "entry"}:${key}:${iter}`);
      // Simulate each modeled game ONCE for this unit; all legs read the same game.
      let hitterOutcome: import("./jointSim").HitterGameOutcome | null = null;
      let pitcherOutcome: import("./jointSim").PitcherGameOutcome | null = null;
      for (const leg of unitLegs) {
        if (!supported[leg.id]) continue;
        let value: number;
        if (leg.model.kind === "hitter") {
          if (!hitterOutcome) hitterOutcome = simulateHitterGame(leg.model.rates, leg.model.expectedPa, rng);
          value = hitterOutcome[HITTER_FIELDS[leg.market]];
        } else {
          if (!pitcherOutcome) pitcherOutcome = simulatePitcherGame(leg.model.allowedRates, leg.model.expectedBF, rng);
          value = pitcherOutcome[PITCHER_FIELDS[leg.market]];
        }
        const win = leg.direction === "more" ? value > leg.line : value < leg.line;
        const push = value === leg.line;
        if (push) pushCounts[leg.id]++;
        if (win) {
          indicators[leg.id][iter] = 1;
          winCounts[leg.id]++;
          correctPerIter[iter]++;
        }
      }
    }
  }

  const legResults: EntryLegResult[] = legs.map((leg) => ({
    id: leg.id,
    label: leg.label,
    market: leg.market,
    direction: leg.direction,
    line: leg.line,
    probWin: winCounts[leg.id] / iterations,
    probPush: pushCounts[leg.id] / iterations,
    supported: supported[leg.id],
  }));

  for (const r of legResults) {
    if (r.probPush > 0.01) warnings.push(`Leg "${r.label}" has a ${(r.probPush * 100).toFixed(1)}% push chance on an integer line; use a .5 line to avoid re-sizing.`);
  }

  // Outcome distribution over number of correct legs.
  const distribution = new Array(size + 1).fill(0);
  for (let iter = 0; iter < iterations; iter++) distribution[correctPerIter[iter]]++;
  for (let k = 0; k <= size; k++) distribution[k] /= iterations;

  // Correlation + contradictions from indicator vectors.
  const legRefs: LegRef[] = legs.filter((l) => supported[l.id]).map((l) => ({
    id: l.id, label: l.label, playerId: l.playerId, gamePk: l.gamePk, market: l.market, direction: l.direction,
  }));
  const correlations = analyzeCorrelations(legRefs, indicators);
  const contradictions = correlations.filter((c) => c.contradiction);

  // Payout.
  const table = input.payoutTable ?? defaultPayoutTable(input.entryType, size);
  const { ev, breakdown } = expectedPayout(table, distribution);
  if (Object.keys(table.byCorrect).length === 0) {
    warnings.push(`No payout multipliers configured for a ${input.entryType} entry of size ${size}; expected payout is 0.`);
  }

  // Correct-count mean/std for a variance sense.
  let mean = 0;
  for (let k = 0; k <= size; k++) mean += k * distribution[k];
  let variance = 0;
  for (let k = 0; k <= size; k++) variance += distribution[k] * (k - mean) ** 2;

  if (contradictions.length > 0) {
    warnings.push(`${contradictions.length} internally-inconsistent leg pair(s) detected — see correlations.`);
  }

  return {
    entryType: input.entryType,
    size,
    iterations,
    legs: legResults,
    distribution,
    correlations,
    contradictions,
    payout: { table: table.label, ev: Math.round(ev * 1000) / 1000, breakdown },
    probAllWin: distribution[size] ?? 0,
    correctCountStdDev: Math.sqrt(variance),
    warnings: [...new Set(warnings)],
  };
}

export { defaultPayoutTable } from "./payout";
export type { PayoutTable, EntryType } from "./payout";
