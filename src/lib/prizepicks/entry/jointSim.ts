/* ============================================================================
   Joint game simulation for entry analysis. Unlike the marginal simulators
   (which summarize one prop at a time), this keeps the per-iteration JOINT
   outcomes for a player's game so that multiple markets on the SAME player-game
   are naturally correlated (e.g. a pitcher's strikeouts and outs move together).

   - Hitter game: a sequence of plate appearances drawn from per-PA rates (reuses
     the PA outcome model). Yields hits / total bases / HR / singles / doubles /
     triples / walks / batter strikeouts. Runs & RBIs are NOT modeled here (they
     depend on lineup/baserunner state this engine does not simulate), so those
     markets are unsupported rather than fabricated.
   - Pitcher game: a sequence of batters faced, each drawn from the pitcher's
     allowed per-BF rates, run through a simple bases-state advancement model.
     Yields strikeouts / outs / hits allowed / walks / HR allowed / earned runs.
     The run model is a standard simplification (all runs earned, no double
     plays / steals / errors) — documented, not exact.

   Same-player-game legs share one simulation stream (correlated). Different
   player-games are simulated from independent streams (no cross-entity game
   state is modeled — an honest limitation).
   ========================================================================== */

import { mulberry32, seedFromString, gaussian, type Rng } from "@/lib/math/stats";
import { clamp } from "@/lib/utils";
import type { PaRates } from "@/lib/prediction/paSim";

export type BfOutcome = "k" | "bb" | "hbp" | "single" | "double" | "triple" | "hr" | "out";

/** Sample one plate appearance / batter faced from outcome rates. */
export function sampleOutcome(rates: PaRates, rng: Rng): BfOutcome {
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

export interface HitterGameOutcome {
  hits: number;
  total_bases: number;
  home_runs: number;
  singles: number;
  doubles: number;
  triples: number;
  walks: number;
  batter_strikeouts: number;
}

export function simulateHitterGame(rates: PaRates, expectedPa: number, rng: Rng): HitterGameOutcome {
  const nPa = clamp(Math.round(expectedPa + gaussian(rng) * 0.6), 1, 7);
  const o: HitterGameOutcome = {
    hits: 0, total_bases: 0, home_runs: 0, singles: 0, doubles: 0, triples: 0, walks: 0, batter_strikeouts: 0,
  };
  for (let p = 0; p < nPa; p++) {
    switch (sampleOutcome(rates, rng)) {
      case "k": o.batter_strikeouts++; break;
      case "bb": o.walks++; break;
      case "single": o.hits++; o.total_bases += 1; o.singles++; break;
      case "double": o.hits++; o.total_bases += 2; o.doubles++; break;
      case "triple": o.hits++; o.total_bases += 3; o.triples++; break;
      case "hr": o.hits++; o.total_bases += 4; o.home_runs++; break;
      // hbp / out contribute nothing to these markets
    }
  }
  return o;
}

export interface PitcherGameOutcome {
  strikeouts: number;
  pitcher_outs: number;
  hits_allowed: number;
  pitcher_walks: number;
  home_runs_allowed: number;
  earned_runs: number;
}

/**
 * Bases-state run model: booleans for [first, second, third]. Standard
 * simplified advancement (advance-one on a single, advance-two on a double,
 * clear on triple/HR, force on walk). All runs treated earned. Returns runs
 * scored on this batter's outcome and mutates `bases`.
 */
function advance(bases: [boolean, boolean, boolean], outcome: BfOutcome): number {
  let runs = 0;
  const [b1, b2, b3] = bases;
  switch (outcome) {
    case "bb":
    case "hbp": {
      // Force only advances runners when bases behind are occupied.
      if (b1 && b2 && b3) runs += 1; // bases loaded → forced run
      if (b1 && b2) bases[2] = true;
      if (b1) bases[1] = true;
      bases[0] = true;
      break;
    }
    case "single": {
      if (b3) runs += 1;
      bases[2] = b2;
      bases[1] = b1;
      bases[0] = true;
      break;
    }
    case "double": {
      if (b3) runs += 1;
      if (b2) runs += 1;
      bases[2] = b1;
      bases[1] = true;
      bases[0] = false;
      break;
    }
    case "triple": {
      runs += (b1 ? 1 : 0) + (b2 ? 1 : 0) + (b3 ? 1 : 0);
      bases[0] = false;
      bases[1] = false;
      bases[2] = true;
      break;
    }
    case "hr": {
      runs += 1 + (b1 ? 1 : 0) + (b2 ? 1 : 0) + (b3 ? 1 : 0);
      bases[0] = false;
      bases[1] = false;
      bases[2] = false;
      break;
    }
    // k / out: no advancement in this simplified model
    default:
      break;
  }
  return runs;
}

export function simulatePitcherGame(rates: PaRates, expectedBF: number, rng: Rng): PitcherGameOutcome {
  const nBf = clamp(Math.round(expectedBF + gaussian(rng) * 2.5), 6, 40);
  const o: PitcherGameOutcome = {
    strikeouts: 0, pitcher_outs: 0, hits_allowed: 0, pitcher_walks: 0, home_runs_allowed: 0, earned_runs: 0,
  };
  const bases: [boolean, boolean, boolean] = [false, false, false];
  for (let i = 0; i < nBf; i++) {
    const out = sampleOutcome(rates, rng);
    switch (out) {
      case "k": o.strikeouts++; o.pitcher_outs++; break;
      case "out": o.pitcher_outs++; break;
      case "bb": o.pitcher_walks++; o.earned_runs += advance(bases, out); break;
      case "hbp": o.earned_runs += advance(bases, out); break;
      case "single": o.hits_allowed++; o.earned_runs += advance(bases, out); break;
      case "double": o.hits_allowed++; o.earned_runs += advance(bases, out); break;
      case "triple": o.hits_allowed++; o.earned_runs += advance(bases, out); break;
      case "hr": o.hits_allowed++; o.home_runs_allowed++; o.earned_runs += advance(bases, out); break;
    }
  }
  return o;
}

/** Build a deterministic per-unit RNG so a given player-game reproduces. */
export function unitRng(seed: string): Rng {
  return mulberry32(seedFromString(seed));
}
