/* ============================================================================
   Correlation + contradiction detection over per-iteration leg-success
   indicators (0/1 vectors from the joint simulation). Using joint samples means
   we never assume independence by multiplying marginals when correlated samples
   are available.
   ========================================================================== */

/** Phi / Pearson correlation between two equal-length 0/1 (or numeric) vectors. */
export function correlation(a: number[], b: number[]): number {
  const n = Math.min(a.length, b.length);
  if (n === 0) return 0;
  let sa = 0, sb = 0;
  for (let i = 0; i < n; i++) {
    sa += a[i];
    sb += b[i];
  }
  const ma = sa / n;
  const mb = sb / n;
  let cov = 0, va = 0, vb = 0;
  for (let i = 0; i < n; i++) {
    const da = a[i] - ma;
    const db = b[i] - mb;
    cov += da * db;
    va += da * da;
    vb += db * db;
  }
  if (va === 0 || vb === 0) return 0; // a constant leg has no linear correlation
  return cov / Math.sqrt(va * vb);
}

export interface LegRef {
  id: string;
  label: string;
  playerId: number;
  gamePk?: number;
  market: string;
  direction: "more" | "less";
}

export interface CorrelationPair {
  aId: string;
  bId: string;
  aLabel: string;
  bLabel: string;
  correlation: number;
  sameUnit: boolean;
  /** True when the two picks embed opposing assumptions given their directions. */
  contradiction: boolean;
  note: string;
}

/** Markets whose underlying quantities are POSITIVELY related for a pitcher. */
const PITCHER_POS: [string, string][] = [
  ["strikeouts", "pitcher_outs"],
  ["pitcher_walks", "earned_runs"],
  ["hits_allowed", "earned_runs"],
  ["home_runs_allowed", "earned_runs"],
];
/** Markets NEGATIVELY related for a pitcher (more of one ⇒ fewer of the other). */
const PITCHER_NEG: [string, string][] = [
  ["strikeouts", "hits_allowed"],
  ["strikeouts", "earned_runs"],
];
const HITTER_POS: [string, string][] = [
  ["hits", "total_bases"],
  ["total_bases", "hits_runs_rbis"],
  ["home_runs", "total_bases"],
];

function relation(marketA: string, marketB: string): "pos" | "neg" | "none" {
  const pair = (list: [string, string][]) =>
    list.some(([x, y]) => (x === marketA && y === marketB) || (x === marketB && y === marketA));
  if (pair(PITCHER_POS) || pair(HITTER_POS)) return "pos";
  if (pair(PITCHER_NEG)) return "neg";
  return "none";
}

/**
 * A contradiction is a same-unit pair whose CHOSEN directions bet against the
 * markets' underlying relationship — e.g. More strikeouts + More hits allowed
 * (K and hits are negatively related, so backing both "More" is internally
 * inconsistent), or an observed strong negative sample correlation between two
 * "More" legs on the same game.
 */
export function detectContradiction(
  a: LegRef,
  b: LegRef,
  sampleCorr: number,
): { contradiction: boolean; note: string } {
  if (a.playerId !== b.playerId || a.gamePk !== b.gamePk) {
    return { contradiction: false, note: "different player/game — treated as independent" };
  }
  const rel = relation(a.market, b.market);
  const sameDir = a.direction === b.direction;

  if (rel === "neg" && sameDir) {
    return {
      contradiction: true,
      note: `${a.market} and ${b.market} are negatively related; backing both "${a.direction}" is internally inconsistent.`,
    };
  }
  if (rel === "pos" && !sameDir) {
    return {
      contradiction: true,
      note: `${a.market} and ${b.market} move together; opposite directions bet against that relationship.`,
    };
  }
  if (Math.abs(sampleCorr) >= 0.35) {
    const winsTogether = sampleCorr > 0;
    return {
      contradiction: !winsTogether,
      note: winsTogether
        ? `Legs win together (r=${sampleCorr.toFixed(2)}): higher combined ceiling but higher variance.`
        : `Legs tend to win in opposite scenarios (r=${sampleCorr.toFixed(2)}): they partially cancel.`,
    };
  }
  return { contradiction: false, note: "no strong relationship detected" };
}

/** Correlation matrix + flagged pairs from indicator vectors. */
export function analyzeCorrelations(
  legs: LegRef[],
  indicators: Record<string, number[]>,
): CorrelationPair[] {
  const pairs: CorrelationPair[] = [];
  for (let i = 0; i < legs.length; i++) {
    for (let j = i + 1; j < legs.length; j++) {
      const a = legs[i];
      const b = legs[j];
      const r = correlation(indicators[a.id] ?? [], indicators[b.id] ?? []);
      const { contradiction, note } = detectContradiction(a, b, r);
      pairs.push({
        aId: a.id,
        bId: b.id,
        aLabel: a.label,
        bLabel: b.label,
        correlation: Math.round(r * 1000) / 1000,
        sameUnit: a.playerId === b.playerId && a.gamePk === b.gamePk,
        contradiction,
        note,
      });
    }
  }
  return pairs;
}
