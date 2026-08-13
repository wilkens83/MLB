/* ============================================================================
   Per-batter-faced ALLOWED event rates for a starting pitcher. Each event has
   its OWN process (K/BF, BB/BF, H/BF, HR/BF) — never a single generic multiplier
   — so a start can produce many hits but few walks, etc. Rates are estimated
   from the pitcher's game log and shrunk toward explicit, versioned league priors
   by batters-faced sample strength. Pure + deterministic.
   ========================================================================== */

import { clamp } from "@/lib/utils";
import { LEAGUE_PA_RATES } from "@/lib/prediction/paSim";
import type { PitcherRates } from "./types";

/** Real pitcher fields we read per start (all optional — provenance tracks gaps). */
export interface PitcherStartStat {
  battersFaced?: number;
  numberOfPitches?: number;
  outs?: number;
  inningsPitched?: string;
  strikeOuts?: number;
  baseOnBalls?: number;
  hitByPitch?: number;
  hits?: number;
  doubles?: number;
  triples?: number;
  homeRuns?: number;
  earnedRuns?: number;
  atBats?: number;
}

/** Innings-pitched string ("6.2") → outs. */
export function inningsToOuts(ip?: string): number {
  if (!ip) return 0;
  const [whole, frac] = String(ip).split(".");
  return (Number(whole) || 0) * 3 + (Number(frac) || 0);
}

/** Batters faced for a start, from the field or reconstructed from outs+baserunners. */
export function battersFacedOf(s: PitcherStartStat): number {
  if (s.battersFaced && s.battersFaced > 0) return s.battersFaced;
  const outs = s.outs ?? inningsToOuts(s.inningsPitched);
  const onBase = (s.hits ?? 0) + (s.baseOnBalls ?? 0) + (s.hitByPitch ?? 0);
  return outs + onBase;
}

const PRIOR_BF_STRENGTH = 70; // ≈ 3 starts of batters faced before data dominates

/**
 * Estimate allowed per-BF rates from the pitcher's starts, shrunk toward the
 * league prior by total batters faced. Recent starts are up-weighted (EWMA-ish)
 * so a changed profile surfaces faster without overreacting to one outing.
 */
export function estimatePitcherRates(
  starts: PitcherStartStat[],
  opts: { priorStrength?: number } = {},
): PitcherRates {
  const priorStrength = opts.priorStrength ?? PRIOR_BF_STRENGTH;
  // Recency weights: newest start weight 1.0, decaying by 0.85 (log is oldest→newest).
  const n = starts.length;
  let wBf = 0;
  const acc = { k: 0, bb: 0, hbp: 0, single: 0, double: 0, triple: 0, hr: 0 };
  starts.forEach((s, i) => {
    const w = Math.pow(0.85, n - 1 - i);
    const bf = battersFacedOf(s);
    if (bf <= 0) return;
    const hr = s.homeRuns ?? 0;
    const dbl = s.doubles ?? 0;
    const trp = s.triples ?? 0;
    const single = Math.max(0, (s.hits ?? 0) - dbl - trp - hr);
    wBf += w * bf;
    acc.k += w * (s.strikeOuts ?? 0);
    acc.bb += w * (s.baseOnBalls ?? 0);
    acc.hbp += w * (s.hitByPitch ?? 0);
    acc.single += w * single;
    acc.double += w * dbl;
    acc.triple += w * trp;
    acc.hr += w * hr;
  });

  const blend = (events: number, prior: number) => (events + prior * priorStrength) / (wBf + priorStrength);
  return normalizeRates({
    k: blend(acc.k, LEAGUE_PA_RATES.k),
    bb: blend(acc.bb, LEAGUE_PA_RATES.bb),
    hbp: blend(acc.hbp, LEAGUE_PA_RATES.hbp),
    single: blend(acc.single, LEAGUE_PA_RATES.single),
    double: blend(acc.double, LEAGUE_PA_RATES.double),
    triple: blend(acc.triple, LEAGUE_PA_RATES.triple),
    hr: blend(acc.hr, LEAGUE_PA_RATES.hr),
  });
}

type NonOutRates = Omit<PitcherRates, "out">;

/** Clamp non-out probabilities so ≥5% "out" mass remains, then set out = residual. */
export function normalizeRates(r: NonOutRates): PitcherRates {
  let { k, bb, hbp, single, double, triple, hr } = r;
  const nonOut = k + bb + hbp + single + double + triple + hr;
  if (nonOut > 0.95) {
    const scale = 0.95 / nonOut;
    k *= scale; bb *= scale; hbp *= scale; single *= scale; double *= scale; triple *= scale; hr *= scale;
  }
  const out = Math.max(0, 1 - (k + bb + hbp + single + double + triple + hr));
  return { k, bb, hbp, single, double, triple, hr, out };
}

/**
 * Apply opponent + context multipliers to the base rates. Each rate has its OWN
 * multiplier (never one shared factor). Multipliers of 1 = neutral (no context).
 */
export interface RateContext {
  kMult?: number; // opponent K tendency / whiff profile
  bbMult?: number; // opponent discipline
  hitMult?: number; // opponent contact quality
  hrMult?: number; // opponent power / park
}

export function adjustPitcherRates(r: PitcherRates, ctx: RateContext): PitcherRates {
  const kMult = clamp(ctx.kMult ?? 1, 0.5, 1.8);
  const bbMult = clamp(ctx.bbMult ?? 1, 0.5, 1.8);
  const hitMult = clamp(ctx.hitMult ?? 1, 0.6, 1.6);
  const hrMult = clamp(ctx.hrMult ?? 1, 0.5, 2.0);
  return normalizeRates({
    k: r.k * kMult,
    bb: r.bb * bbMult,
    hbp: r.hbp,
    single: r.single * hitMult,
    double: r.double * hitMult,
    triple: r.triple * hitMult,
    hr: r.hr * hrMult,
  });
}

/** Convenience view of the four canonical per-BF rates (out is the remainder). */
export function ratesPerBf(r: PitcherRates): { kPerBf: number; bbPerBf: number; hPerBf: number; hrPerBf: number } {
  return {
    kPerBf: r.k,
    bbPerBf: r.bb,
    hPerBf: r.single + r.double + r.triple + r.hr,
    hrPerBf: r.hr,
  };
}
