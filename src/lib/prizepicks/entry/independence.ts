/* ============================================================================
   Independence approximation. When only marginal per-leg win probabilities are
   available (no joint simulation), the number-correct distribution is the
   Poisson-binomial convolution of the marginals. This ASSUMES independence and
   is therefore an approximation — it must be labeled as such and never presented
   as equivalent to joint simulation (correlated legs violate the assumption).
   ========================================================================== */

import { entryEconomics, defaultPayoutTable, type EntryFormat, type PrizePicksPayoutTable } from "./payout";

/** Poisson-binomial distribution: P(exactly k of n independent successes). */
export function poissonBinomial(probs: number[]): number[] {
  let dist = [1]; // P(0 successes) = 1 with no legs
  for (const p of probs) {
    const q = Math.min(1, Math.max(0, p));
    const next = new Array(dist.length + 1).fill(0);
    for (let k = 0; k < dist.length; k++) {
      next[k] += dist[k] * (1 - q); // leg fails
      next[k + 1] += dist[k] * q; // leg wins
    }
    dist = next;
  }
  return dist;
}

export interface IndependenceEntryResult {
  method: "independence-approximation";
  entryType: EntryFormat;
  size: number;
  distribution: number[];
  probAllWin: number;
  economics: ReturnType<typeof entryEconomics>;
  warnings: string[];
}

/**
 * Entry distribution + economics from marginal leg probabilities ONLY. Always
 * carries a prominent independence-approximation warning.
 */
export function analyzeEntryFromMarginals(input: {
  legProbabilities: number[];
  entryType: EntryFormat;
  payoutTable?: PrizePicksPayoutTable;
  stake?: number;
}): IndependenceEntryResult {
  const size = input.legProbabilities.length;
  const distribution = poissonBinomial(input.legProbabilities);
  const table = input.payoutTable ?? defaultPayoutTable(input.entryType, size);
  const economics = entryEconomics(table, distribution, input.stake ?? 1);
  return {
    method: "independence-approximation",
    entryType: input.entryType,
    size,
    distribution,
    probAllWin: distribution[size] ?? 0,
    economics,
    warnings: [
      "Independence approximation: leg outcomes were assumed independent (marginals only). Correlated legs (same player/game) are NOT captured — use joint simulation for a correct correlation-aware result.",
      ...(economics.configured ? [] : ["Payout configuration required — economic EV withheld."]),
    ],
  };
}
