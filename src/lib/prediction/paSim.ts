/* ============================================================================
   Plate-appearance simulation engine (2F). Simulates a batter's game one plate
   appearance at a time from per-PA outcome probabilities (Bayesian-shrunk to a
   league baseline, then adjusted for the opposing pitcher and context), and
   accumulates the batting props it can model directly from PA outcomes.

   Scope (honest): PA outcomes yield HITS, TOTAL BASES, HOME RUNS, SINGLES,
   DOUBLES, TRIPLES, WALKS, and BATTER STRIKEOUTS. Runs, RBIs, H+R+RBI, steals,
   and fantasy points depend on baserunner/lineup state this engine does not
   model, so those remain on the marginal game-log simulator — we do not
   fabricate baserunner outcomes.
   ========================================================================== */

import { mulberry32, seedFromString, gaussian, type Rng } from "@/lib/math/stats";
import { clamp } from "@/lib/utils";
import { summarizeSamples, type SimulationResult } from "./simulate";
import type { GameLogEntry, StatcastPitcher } from "@/lib/domain/models";

export interface PaRates {
  k: number;
  bb: number;
  hbp: number;
  single: number;
  double: number;
  triple: number;
  hr: number;
  out: number;
}

/** MLB-average per-PA outcome baseline, used as the shrinkage prior. */
export const LEAGUE_PA_RATES: PaRates = {
  k: 0.225,
  bb: 0.085,
  hbp: 0.011,
  single: 0.145,
  double: 0.045,
  triple: 0.004,
  hr: 0.035,
  out: 0.45,
};

/** Props this engine models directly from simulated plate appearances. */
export const PA_MODELED_PROPS = new Set([
  "hits", "total_bases", "home_runs", "singles", "doubles", "triples",
  "walks", "batter_strikeouts",
]);

interface HittingTotals {
  pa: number;
  ab: number;
  k: number;
  bb: number;
  hbp: number;
  hr: number;
  double: number;
  triple: number;
  single: number;
  games: number;
}

function sumHitting(log: GameLogEntry[]): HittingTotals {
  const t: HittingTotals = { pa: 0, ab: 0, k: 0, bb: 0, hbp: 0, hr: 0, double: 0, triple: 0, single: 0, games: 0 };
  for (const g of log) {
    const s = g.stat;
    const ab = s.atBats ?? 0;
    const bb = s.baseOnBalls ?? 0;
    const hbp = s.hitByPitch ?? 0;
    const hits = s.hits ?? 0;
    const dbl = s.doubles ?? 0;
    const trp = s.triples ?? 0;
    const hr = s.homeRuns ?? 0;
    if (ab + bb + hbp === 0) continue;
    t.ab += ab;
    t.bb += bb;
    t.hbp += hbp;
    t.k += s.strikeOuts ?? 0;
    t.hr += hr;
    t.double += dbl;
    t.triple += trp;
    t.single += Math.max(0, hits - dbl - trp - hr);
    t.pa += ab + bb + hbp;
    t.games++;
  }
  return t;
}

/** Bayesian-shrunk per-PA rates from a batter's game log. */
export function estimatePaRates(log: GameLogEntry[], priorStrength = 60): PaRates {
  const t = sumHitting(log);
  const pa = t.pa;
  const w = pa / (pa + priorStrength); // weight on observed
  const blend = (obs: number, prior: number) => w * (pa > 0 ? obs / pa : prior) + (1 - w) * prior;
  const raw = {
    k: blend(t.k, LEAGUE_PA_RATES.k),
    bb: blend(t.bb, LEAGUE_PA_RATES.bb),
    hbp: blend(t.hbp, LEAGUE_PA_RATES.hbp),
    single: blend(t.single, LEAGUE_PA_RATES.single),
    double: blend(t.double, LEAGUE_PA_RATES.double),
    triple: blend(t.triple, LEAGUE_PA_RATES.triple),
    hr: blend(t.hr, LEAGUE_PA_RATES.hr),
  };
  const nonOut = raw.k + raw.bb + raw.hbp + raw.single + raw.double + raw.triple + raw.hr;
  return { ...raw, out: Math.max(0.05, 1 - nonOut) };
}

/** Average PAs per game from the log (fallback 4.2). */
export function expectedPasPerGame(log: GameLogEntry[]): number {
  const t = sumHitting(log);
  if (t.games === 0) return 4.2;
  return clamp(t.pa / t.games, 3.2, 5.2);
}

export interface PaAdjustments {
  /** Multiplier on strikeout probability (opposing pitcher K%). */
  kMult?: number;
  /** Multiplier on walk probability (opposing pitcher BB%). */
  bbMult?: number;
  /** Multiplier on hit/power outcomes (offense suppression / boost). */
  offenseMult?: number;
}

/** Apply context multipliers to the per-PA rates and renormalize to sum 1. */
export function adjustPaRates(rates: PaRates, adj: PaAdjustments): PaRates {
  const kMult = adj.kMult ?? 1;
  const bbMult = adj.bbMult ?? 1;
  const offMult = adj.offenseMult ?? 1;
  const scaled = {
    k: rates.k * kMult,
    bb: rates.bb * bbMult,
    hbp: rates.hbp,
    single: rates.single * offMult,
    double: rates.double * offMult,
    triple: rates.triple * offMult,
    hr: rates.hr * offMult,
  };
  const nonOut = scaled.k + scaled.bb + scaled.hbp + scaled.single + scaled.double + scaled.triple + scaled.hr;
  // Renormalize so probabilities remain valid; out absorbs the balance.
  const out = Math.max(0.03, 1 - nonOut);
  const total = nonOut + out;
  return {
    k: scaled.k / total,
    bb: scaled.bb / total,
    hbp: scaled.hbp / total,
    single: scaled.single / total,
    double: scaled.double / total,
    triple: scaled.triple / total,
    hr: scaled.hr / total,
    out: out / total,
  };
}

export function paAdjustmentsFromPitcher(pitcher?: StatcastPitcher | null, offenseMult = 1): PaAdjustments {
  const adj: PaAdjustments = { offenseMult };
  if (pitcher) {
    if (pitcher.kPct !== undefined) adj.kMult = clamp((pitcher.kPct / 22) ** 0.7, 0.7, 1.4);
    if (pitcher.bbPct !== undefined) adj.bbMult = clamp((pitcher.bbPct / 8) ** 0.6, 0.7, 1.4);
  }
  return adj;
}

type Outcome = "k" | "bb" | "hbp" | "single" | "double" | "triple" | "hr" | "out";

function samplePa(rates: PaRates, rng: Rng): Outcome {
  const r = rng();
  let acc = rates.k;
  if (r < acc) return "k";
  acc += rates.bb;
  if (r < acc) return "bb";
  acc += rates.hbp;
  if (r < acc) return "hbp";
  acc += rates.single;
  if (r < acc) return "single";
  acc += rates.double;
  if (r < acc) return "double";
  acc += rates.triple;
  if (r < acc) return "triple";
  acc += rates.hr;
  if (r < acc) return "hr";
  return "out";
}

export interface PaSimConfig {
  iterations?: number;
  seed?: string;
  expectedPa?: number;
}

export interface PaGameResult {
  hits: number;
  total_bases: number;
  home_runs: number;
  singles: number;
  doubles: number;
  triples: number;
  walks: number;
  batter_strikeouts: number;
}

/**
 * Run the plate-appearance simulation and return a SimulationResult per modeled
 * prop, keyed by prop key, evaluated against the supplied line map.
 */
export function simulatePlateAppearances(
  rates: PaRates,
  lines: Partial<Record<keyof PaGameResult, number>>,
  config: PaSimConfig = {},
): Record<string, SimulationResult> {
  const iterations = config.iterations ?? 10000;
  const expectedPa = config.expectedPa ?? 4.2;
  const rng = mulberry32(seedFromString(config.seed ?? `pa:${expectedPa}:${iterations}`));

  const acc: Record<keyof PaGameResult, number[]> = {
    hits: [], total_bases: [], home_runs: [], singles: [],
    doubles: [], triples: [], walks: [], batter_strikeouts: [],
  };

  for (let i = 0; i < iterations; i++) {
    let nPa = Math.round(expectedPa + gaussian(rng) * 0.6);
    nPa = clamp(nPa, 1, 7);
    let hits = 0, tb = 0, hr = 0, s1 = 0, s2 = 0, s3 = 0, bb = 0, k = 0;
    for (let p = 0; p < nPa; p++) {
      switch (samplePa(rates, rng)) {
        case "k": k++; break;
        case "bb": bb++; break;
        case "single": hits++; tb += 1; s1++; break;
        case "double": hits++; tb += 2; s2++; break;
        case "triple": hits++; tb += 3; s3++; break;
        case "hr": hits++; tb += 4; hr++; break;
        // hbp and out contribute nothing to these props
      }
    }
    acc.hits.push(hits);
    acc.total_bases.push(tb);
    acc.home_runs.push(hr);
    acc.singles.push(s1);
    acc.doubles.push(s2);
    acc.triples.push(s3);
    acc.walks.push(bb);
    acc.batter_strikeouts.push(k);
  }

  const out: Record<string, SimulationResult> = {};
  for (const key of Object.keys(acc) as (keyof PaGameResult)[]) {
    const line = lines[key];
    if (line === undefined) continue;
    out[key] = summarizeSamples(acc[key], line, "negbinom");
  }
  return out;
}
