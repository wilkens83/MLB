/* ============================================================================
   PrizePicks entry payout configuration. PrizePicks offers Power Play (all legs
   must hit) and Flex Play (partial payouts for missing one, sometimes two). The
   exact multipliers vary by promotion and region, so they are CONFIG here — the
   evaluator takes a payout table and never hard-codes "official" numbers. If a
   caller does not supply one, we use the commonly published default table and
   clearly label it as a configurable default.

   A payout table maps entry size → (number correct → payout multiplier of stake).
   ========================================================================== */

export type EntryType = "power" | "flex";

export interface PayoutTable {
  type: EntryType;
  size: number;
  /** multiplier keyed by number of correct legs (pushes reduce effective size). */
  byCorrect: Record<number, number>;
  label: string;
}

/** Commonly published default multipliers (configurable — NOT a guarantee). */
const DEFAULT_POWER: Record<number, Record<number, number>> = {
  2: { 2: 3 },
  3: { 3: 5 },
  4: { 4: 10 },
  5: { 5: 20 },
  6: { 6: 37.5 },
};
const DEFAULT_FLEX: Record<number, Record<number, number>> = {
  3: { 3: 2.25, 2: 1.25 },
  4: { 4: 5, 3: 1.5 },
  5: { 5: 10, 4: 2, 3: 0.4 },
  6: { 6: 25, 5: 2, 4: 0.4 },
};

export function defaultPayoutTable(type: EntryType, size: number): PayoutTable {
  const src = type === "power" ? DEFAULT_POWER[size] : DEFAULT_FLEX[size];
  return {
    type,
    size,
    byCorrect: src ?? {},
    label: `default ${type} ${size}-pick multipliers (configurable — not a guarantee)`,
  };
}

/**
 * Expected payout multiplier of stake given the distribution over number of
 * correct legs. Pushes are handled by the caller by reducing the effective
 * entry (PrizePicks re-sizes an entry down on a push); here we just apply the
 * supplied table to the correct-count distribution.
 */
export function expectedPayout(
  table: PayoutTable,
  distribution: number[], // distribution[k] = P(exactly k correct)
): { ev: number; breakdown: { correct: number; probability: number; multiplier: number }[] } {
  let ev = 0;
  const breakdown: { correct: number; probability: number; multiplier: number }[] = [];
  for (let k = 0; k < distribution.length; k++) {
    const p = distribution[k];
    const mult = table.byCorrect[k] ?? 0;
    ev += p * mult;
    if (p > 0) breakdown.push({ correct: k, probability: p, multiplier: mult });
  }
  return { ev, breakdown };
}
