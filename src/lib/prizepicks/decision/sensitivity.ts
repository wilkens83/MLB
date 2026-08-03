/* ============================================================================
   Assumption-sensitivity sweep. Re-simulates a leg under credible changes to its
   key assumptions and reports how much the selected-side probability moves. A
   firm BET requires the selected side to stay acceptable in the WORST credible
   case — a precise-looking probability that collapses under a small, plausible
   change is fragile and must not drive a BET.
   ========================================================================== */

import { simulateHitterGame, simulatePitcherGame, unitRng, type HitterGameOutcome, type PitcherGameOutcome } from "@/lib/prizepicks/entry/jointSim";
import type { PaRates } from "@/lib/prediction/paSim";
import { clamp } from "@/lib/utils";

const HITTER_FIELD: Record<string, keyof HitterGameOutcome> = {
  hits: "hits", total_bases: "total_bases", home_runs: "home_runs", singles: "singles",
  doubles: "doubles", triples: "triples", walks: "walks", batter_strikeouts: "batter_strikeouts",
};
const PITCHER_FIELD: Record<string, keyof PitcherGameOutcome> = {
  strikeouts: "strikeouts", pitcher_outs: "pitcher_outs", hits_allowed: "hits_allowed",
  pitcher_walks: "pitcher_walks", home_runs_allowed: "home_runs_allowed", earned_runs: "earned_runs",
};

/** Scale the K/BB/hit rates by an "offense" multiplier and renormalize. */
function scaleRates(r: PaRates, offenseMult: number, kMult = 1): PaRates {
  const s = {
    k: r.k * kMult, bb: r.bb, hbp: r.hbp,
    single: r.single * offenseMult, double: r.double * offenseMult,
    triple: r.triple * offenseMult, hr: r.hr * offenseMult,
  };
  const nonOut = s.k + s.bb + s.hbp + s.single + s.double + s.triple + s.hr;
  const out = Math.max(0.03, 1 - nonOut);
  const total = nonOut + out;
  return { k: s.k / total, bb: s.bb / total, hbp: s.hbp / total, single: s.single / total, double: s.double / total, triple: s.triple / total, hr: s.hr / total, out: out / total };
}

export interface SensitivityInput {
  kind: "hitter" | "pitcher";
  market: string;
  line: number;
  direction: "more" | "less";
  rates: PaRates;
  /** Expected plate appearances (hitter) or batters faced (pitcher). */
  expected: number;
  iterations?: number;
  seed?: string;
}

export interface SensitivityResult {
  baseProbability: number;
  worstProbability: number;
  bestProbability: number;
  probabilityRange: number;
  mostInfluentialAssumption: string;
  fragilityScore: number; // 0..100
  scenarios: { label: string; probability: number }[];
}

function probFor(input: SensitivityInput, rates: PaRates, expected: number): number {
  const iters = input.iterations ?? 4000;
  const rng = unitRng(`${input.seed ?? "sens"}:${expected}:${JSON.stringify(rates).length}`);
  let win = 0;
  for (let i = 0; i < iters; i++) {
    let value: number;
    if (input.kind === "hitter") value = simulateHitterGame(rates, expected, rng)[HITTER_FIELD[input.market]];
    else value = simulatePitcherGame(rates, expected, rng)[PITCHER_FIELD[input.market]];
    const w = input.direction === "more" ? value > input.line : value < input.line;
    if (w) win++;
  }
  return win / iters;
}

/**
 * Sweep the material assumptions and summarize. Opportunity (PA/BF) is swept
 * ±1; matchup/offense is swept ±10%; the K axis is swept ±10% (mostly for
 * pitchers). Fragility scales the probability range into 0..100.
 */
export function runSensitivity(input: SensitivityInput): SensitivityResult {
  const base = probFor(input, input.rates, input.expected);
  const scenarios: { label: string; probability: number }[] = [
    { label: "low opportunity (−1 PA/BF)", probability: probFor(input, input.rates, Math.max(1, input.expected - 1)) },
    { label: "high opportunity (+1 PA/BF)", probability: probFor(input, input.rates, input.expected + 1) },
    { label: "tougher matchup (−10% offense)", probability: probFor(input, scaleRates(input.rates, 0.9), input.expected) },
    { label: "easier matchup (+10% offense)", probability: probFor(input, scaleRates(input.rates, 1.1), input.expected) },
    { label: "higher K (+10%)", probability: probFor(input, scaleRates(input.rates, 1, 1.1), input.expected) },
    { label: "lower K (−10%)", probability: probFor(input, scaleRates(input.rates, 1, 0.9), input.expected) },
  ];
  const probs = scenarios.map((s) => s.probability);
  const worst = Math.min(base, ...probs);
  const best = Math.max(base, ...probs);
  const mostInfluential = scenarios.reduce((a, b) => (Math.abs(b.probability - base) > Math.abs(a.probability - base) ? b : a));
  const range = best - worst;
  // Fragility: a 0.20 swing in win prob is very fragile (→ ~100).
  const fragilityScore = clamp(Math.round((range / 0.2) * 100), 0, 100);
  return {
    baseProbability: round(base),
    worstProbability: round(worst),
    bestProbability: round(best),
    probabilityRange: round(range),
    mostInfluentialAssumption: mostInfluential.label,
    fragilityScore,
    scenarios: scenarios.map((s) => ({ label: s.label, probability: round(s.probability) })),
  };
}

function round(x: number): number {
  return Math.round(x * 1000) / 1000;
}
