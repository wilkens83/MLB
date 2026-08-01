/* ============================================================================
   Versioned, configurable PrizePicks payout engine. PrizePicks is NOT a
   traditional sportsbook: economic value comes from the COMPLETE entry against
   the actual payout structure, never from an American price like -110 and never
   from per-leg Kelly. Payout tables are CONFIG — versioned, effective-dated, and
   sourced — and the engine refuses to invent economics when a table is missing
   ("Payout configuration required"). Multipliers below are the commonly
   published defaults, explicitly labeled configurable and never guaranteed.
   ========================================================================== */

export type ProjectionTier = "standard" | "goblin" | "demon" | "discounted" | "promo" | "unknown";
export type EntryFormat = "power" | "flex";

export interface PayoutRule {
  /** Number of correct selections this rule applies to. */
  correctSelections: number;
  /** Multiplier of stake returned (1 = money back, 0 = loss). */
  payoutMultiplier: number;
  /** Optional distinct refund multiplier when the rule is a refund/partial. */
  refundMultiplier?: number;
}

export interface PrizePicksPayoutTable {
  id: string;
  version: string;
  effectiveFrom: string;
  effectiveTo?: string;
  format: EntryFormat;
  pickCount: number;
  tierComposition?: Partial<Record<ProjectionTier, number>>;
  rules: PayoutRule[];
  source: "manual-config" | "admin-config" | "verified-import";
  capturedAt: string;
}

/* Commonly published default multipliers (configurable — NOT guaranteed). */
const DEFAULT_POWER: Record<number, PayoutRule[]> = {
  2: [{ correctSelections: 2, payoutMultiplier: 3 }],
  3: [{ correctSelections: 3, payoutMultiplier: 5 }],
  4: [{ correctSelections: 4, payoutMultiplier: 10 }],
  5: [{ correctSelections: 5, payoutMultiplier: 20 }],
  6: [{ correctSelections: 6, payoutMultiplier: 37.5 }],
};
const DEFAULT_FLEX: Record<number, PayoutRule[]> = {
  3: [
    { correctSelections: 3, payoutMultiplier: 2.25 },
    { correctSelections: 2, payoutMultiplier: 1.25, refundMultiplier: 1.25 },
  ],
  4: [
    { correctSelections: 4, payoutMultiplier: 5 },
    { correctSelections: 3, payoutMultiplier: 1.5 },
  ],
  5: [
    { correctSelections: 5, payoutMultiplier: 10 },
    { correctSelections: 4, payoutMultiplier: 2 },
    { correctSelections: 3, payoutMultiplier: 0.4, refundMultiplier: 0.4 },
  ],
  6: [
    { correctSelections: 6, payoutMultiplier: 25 },
    { correctSelections: 5, payoutMultiplier: 2 },
    { correctSelections: 4, payoutMultiplier: 0.4, refundMultiplier: 0.4 },
  ],
};

const DEFAULT_VERSION = "pp-default-2026.1";

/** Resolve a default versioned table for a format+size, or null if unconfigured. */
export function defaultPayoutTable(format: EntryFormat, pickCount: number): PrizePicksPayoutTable | null {
  const rules = format === "power" ? DEFAULT_POWER[pickCount] : DEFAULT_FLEX[pickCount];
  if (!rules) return null;
  return {
    id: `${DEFAULT_VERSION}-${format}-${pickCount}`,
    version: DEFAULT_VERSION,
    effectiveFrom: "2026-01-01T00:00:00Z",
    format,
    pickCount,
    rules,
    source: "manual-config",
    capturedAt: "2026-01-01T00:00:00Z",
  };
}

export interface EntryEconomics {
  configured: boolean;
  tableId: string | null;
  tableVersion: string | null;
  /** Σ P(exactly k correct) · payoutMultiplier(k). Undefined when unconfigured. */
  expectedReturn?: number;
  /** stake · (expectedReturn − 1). Undefined when unconfigured. */
  expectedProfit?: number;
  /** Same as expectedReturn (multiplier of stake). */
  expectedMultiplier?: number;
  /** P(landing on a rule flagged as a refund). */
  refundProbability?: number;
  breakdown: { correct: number; probability: number; payoutMultiplier: number; refund: boolean }[];
  note: string;
}

/**
 * Entry economics from the correct-count distribution and a payout table.
 * Refuses to compute EV when no table is configured (returns configured:false).
 */
export function entryEconomics(
  table: PrizePicksPayoutTable | null,
  distribution: number[], // distribution[k] = P(exactly k correct)
  stake = 1,
): EntryEconomics {
  if (!table) {
    return {
      configured: false,
      tableId: null,
      tableVersion: null,
      breakdown: [],
      note: "Payout configuration required — no versioned payout table for this format/size. Probabilities, correlation and scenario analysis are still valid.",
    };
  }
  const ruleByK = new Map(table.rules.map((r) => [r.correctSelections, r]));
  let expectedReturn = 0;
  let refundProbability = 0;
  const breakdown: EntryEconomics["breakdown"] = [];
  for (let k = 0; k < distribution.length; k++) {
    const p = distribution[k];
    const rule = ruleByK.get(k);
    const mult = rule?.payoutMultiplier ?? 0;
    expectedReturn += p * mult;
    const isRefund = rule?.refundMultiplier !== undefined;
    if (isRefund) refundProbability += p;
    if (p > 0) breakdown.push({ correct: k, probability: p, payoutMultiplier: mult, refund: isRefund });
  }
  return {
    configured: true,
    tableId: table.id,
    tableVersion: table.version,
    expectedReturn: round(expectedReturn),
    expectedProfit: round(stake * (expectedReturn - 1)),
    expectedMultiplier: round(expectedReturn),
    refundProbability: round(refundProbability),
    breakdown,
    note: `Economics from ${table.format} payout table ${table.version} (configurable — not a guarantee).`,
  };
}

function round(x: number, d = 4): number {
  const f = 10 ** d;
  return Math.round(x * f) / f;
}
