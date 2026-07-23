/* ============================================================================
   Fair-line estimation + sensitivity. For discrete markets (aces, games, sets)
   the fair line is derived directly from the simulated sample distribution, and
   we report how the More-probability moves as the line shifts by ±0.5 — the
   input future line-movement logic will need.
   ========================================================================== */

import { round } from "@/lib/utils";

export interface FairLine {
  /** Median of the simulated distribution. */
  medianFairLine: number;
  /** Mean of the simulated distribution. */
  meanFairLine: number;
  /** Nearest actionable half-line to the median (…, x.5). */
  nearestActionableLine: number;
  /** P(sample > currentLine). */
  probabilityAtLine: number;
  /** P(more) at currentLine + 0.5 and − 0.5, for sensitivity. */
  probabilityAtPlusHalf: number;
  probabilityAtMinusHalf: number;
}

/** Fraction of samples strictly greater than `line`. */
export function probMore(samples: number[], line: number): number {
  if (samples.length === 0) return 0;
  let over = 0;
  for (const s of samples) if (s > line) over++;
  return over / samples.length;
}

/** Fraction strictly less / exactly equal (push) — push only meaningful on integer lines. */
export function probLessPush(samples: number[], line: number): { less: number; push: number } {
  if (samples.length === 0) return { less: 0, push: 0 };
  let less = 0, push = 0;
  for (const s of samples) {
    if (s < line) less++;
    else if (s === line) push++;
  }
  return { less: less / samples.length, push: push / samples.length };
}

function nearestHalf(x: number): number {
  return Math.round(x - 0.5) + 0.5;
}

export function computeFairLine(samples: number[], currentLine: number, median: number, mean: number): FairLine {
  return {
    medianFairLine: round(median, 2),
    meanFairLine: round(mean, 2),
    nearestActionableLine: nearestHalf(median),
    probabilityAtLine: round(probMore(samples, currentLine), 4),
    probabilityAtPlusHalf: round(probMore(samples, currentLine + 0.5), 4),
    probabilityAtMinusHalf: round(probMore(samples, currentLine - 0.5), 4),
  };
}
