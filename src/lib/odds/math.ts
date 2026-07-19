/* ============================================================================
   Odds math — conversions between American / decimal / implied probability,
   vig removal, expected value, Kelly staking, and closing-line value.
   Pure functions, no I/O.
   ========================================================================== */

/** American odds → decimal odds. */
export function americanToDecimal(american: number): number {
  if (american === 0) return 1;
  return american > 0 ? american / 100 + 1 : 100 / -american + 1;
}

/** Decimal odds → American odds. */
export function decimalToAmerican(decimal: number): number {
  if (decimal <= 1) return 0;
  return decimal >= 2 ? Math.round((decimal - 1) * 100) : Math.round(-100 / (decimal - 1));
}

/** American odds → implied probability (with vig). */
export function americanToImplied(american: number): number {
  return american > 0 ? 100 / (american + 100) : -american / (-american + 100);
}

/** Decimal odds → implied probability. */
export function decimalToImplied(decimal: number): number {
  return decimal <= 1 ? 1 : 1 / decimal;
}

/** Probability → fair American odds (no vig). */
export function impliedToAmerican(p: number): number {
  if (p <= 0) return Infinity;
  if (p >= 1) return -Infinity;
  return decimalToAmerican(1 / p);
}

/**
 * Remove the vig from a two-way market, returning fair probabilities that sum
 * to 1. Uses the standard proportional (multiplicative) method.
 */
export function removeVigTwoWay(
  overAmerican: number,
  underAmerican: number,
): { over: number; under: number; hold: number } {
  const o = americanToImplied(overAmerican);
  const u = americanToImplied(underAmerican);
  const overround = o + u;
  return {
    over: o / overround,
    under: u / overround,
    hold: overround - 1,
  };
}

/** Book hold (vig) across an arbitrary set of American prices. */
export function holdPercent(americanOdds: number[]): number {
  const sum = americanOdds.reduce((acc, a) => acc + americanToImplied(a), 0);
  return sum - 1;
}

/**
 * Expected value per 1 unit staked, given the model's true win probability and
 * the offered American price. Returns EV as a fraction (0.05 = +5% ROI).
 */
export function expectedValue(pWin: number, american: number): number {
  const dec = americanToDecimal(american);
  const profit = dec - 1;
  return pWin * profit - (1 - pWin);
}

/** Edge = model probability − implied (vig-included) probability of the price. */
export function edge(pWin: number, american: number): number {
  return pWin - americanToImplied(american);
}

/**
 * Kelly criterion fraction of bankroll. `fraction` scales it (0.25 = quarter
 * Kelly). Negative EV → 0 (never stake).
 */
export function kelly(pWin: number, american: number, fraction = 1): number {
  const dec = americanToDecimal(american);
  const b = dec - 1;
  if (b <= 0) return 0;
  const q = 1 - pWin;
  const f = (b * pWin - q) / b;
  return f > 0 ? f * fraction : 0;
}

/**
 * Closing Line Value — how much better your entry price was than the closing
 * price, expressed as a probability delta (positive = you beat the close).
 */
export function closingLineValue(entryAmerican: number, closeAmerican: number): number {
  return americanToImplied(closeAmerican) - americanToImplied(entryAmerican);
}

export interface ArbLeg {
  book: string;
  american: number;
}

export interface ArbOpportunity {
  isArb: boolean;
  /** Sum of implied probabilities across the best legs; < 1 means arbitrage. */
  totalImplied: number;
  /** Guaranteed return on total stake (e.g. 0.03 = 3%). */
  returnPct: number;
  legs: { book: string; american: number; stakePct: number }[];
}

/**
 * Detect a two-way arbitrage from the best price available on each side.
 * `overLegs`/`underLegs` are the same market at different books.
 */
export function detectArbitrage(overLegs: ArbLeg[], underLegs: ArbLeg[]): ArbOpportunity | null {
  if (overLegs.length === 0 || underLegs.length === 0) return null;
  const bestOver = overLegs.reduce((a, b) => (a.american > b.american ? a : b));
  const bestUnder = underLegs.reduce((a, b) => (a.american > b.american ? a : b));
  const io = americanToImplied(bestOver.american);
  const iu = americanToImplied(bestUnder.american);
  const total = io + iu;
  const stakeOver = io / total;
  const stakeUnder = iu / total;
  return {
    isArb: total < 1,
    totalImplied: total,
    returnPct: total < 1 ? 1 / total - 1 : 0,
    legs: [
      { book: bestOver.book, american: bestOver.american, stakePct: stakeOver },
      { book: bestUnder.book, american: bestUnder.american, stakePct: stakeUnder },
    ],
  };
}
