/* ============================================================================
   Pick Selector — the board-wide ranked SELECTION layer.

   This is a pure composition on top of the existing firm decision engine
   (`prizepicks/decision`): it does NOT re-project or re-simulate anything. It
   takes the per-leg analytical facts the decision engine already produced
   (projection, selected-side probability, data quality, confidence, fragility,
   firm decision + reasons) and turns a whole board into a ranked, graded,
   filtered shortlist grouped TOP / STRONG / PLAYABLE / WATCH / PASS.

   Two hard rules from the Pick Selection Engine spec are enforced here:
   1. PASS is a first-class outcome — a weak edge, thin data, high fragility,
      an unmet filter, or a firm NO_BET/UNAVAILABLE all resolve to PASS. The
      selector never invents strength to fill a ticket.
   2. Same-player / same-game props are never assumed independent — conflicts
      (e.g. same-pitcher More K + More Hits) are surfaced from market
      relationships before anything is treated as a clean edge.

   The analytical GRADE (pick quality) is kept distinct from the firm DECISION
   (play/pass): a pick can grade well yet still be WAIT/NO_BET because the
   market lifecycle or a veto blocks a firm bet. The selector never overrides a
   veto — a firm UNAVAILABLE/NO_BET caps the grade at PASS.
   ========================================================================== */

import { clamp } from "@/lib/utils";
import type { AnyDecision, DecisionResult } from "@/lib/prizepicks/decision/types";
import { detectContradiction, type LegRef } from "@/lib/prizepicks/entry/correlation";

export type PickGrade = "A+" | "A" | "B" | "C" | "PASS";
export type PickTier = "TOP" | "STRONG" | "PLAYABLE" | "WATCH" | "PASS";
export type PickDirection = "more" | "less";

/** The analytical facts one candidate prop carries INTO the selector. These map
    1:1 from a decision-engine `DecisionResult` (see `fromDecisionResult`). */
export interface SelectorCandidate {
  id: string;
  playerId: number;
  playerName: string;
  gamePk?: number;
  market: string;
  marketLabel?: string;
  line: number;
  /** Model-favored side (the side whose probability exceeds 0.5). */
  direction: PickDirection;
  projection?: number;
  /** Probability the FAVORED side wins, in [0.5, 1]. */
  selectedSideProbability: number;
  /** 0..1 completeness/freshness of the inputs. */
  dataQuality: number;
  /** 0..1 model confidence. */
  confidence: number;
  /** 0..1 fragility/uncertainty (higher = worse). */
  uncertainty: number;
  /** The firm decision from the decision engine (veto-respecting). */
  decision: AnyDecision;
  /** Whether today's lineup/starter is confirmed (vs projected). */
  lineupConfirmed: boolean;
  reasons?: string[];
}

export interface PickSelectorFilters {
  markets?: string[];
  /** Minimum favored-side probability (0..1). */
  minProbability: number;
  /** Minimum edge over the 50/50 pick'em breakeven (0..1, e.g. 0.08). */
  minEdge: number;
  /** Minimum data quality (0..1). */
  minDataQuality: number;
  /** Maximum acceptable uncertainty/fragility (0..1). */
  maxUncertainty: number;
  requireLineupConfirmed: boolean;
  maxSamePlayer: number;
  maxSameGame: number;
}

export const DEFAULT_SELECTOR_FILTERS: PickSelectorFilters = {
  minProbability: 0.58,
  minEdge: 0.08,
  minDataQuality: 0.8,
  maxUncertainty: 0.6,
  requireLineupConfirmed: false,
  maxSamePlayer: 1,
  maxSameGame: 2,
};

/** Score weights (documented, versioned). Sum of positive weights = 1; the two
    penalties subtract. The score is clamped to [0,1] then scaled to 0..100. */
export const SELECTOR_SCORE_VERSION = "pick-selector-1.0.0";
const W = {
  probEdge: 0.45, // directional conviction: (P - 0.5) / 0.5
  dataQuality: 0.25,
  confidence: 0.15,
  lineupCertainty: 0.15,
  uncertaintyPenalty: 0.2,
  conflictPenalty: 0.15,
} as const;

export interface GradedPick {
  candidate: SelectorCandidate;
  /** Edge over the 50/50 pick'em breakeven = P(favored) − 0.5. */
  edge: number;
  score: number; // 0..100
  grade: PickGrade;
  tier: PickTier;
  /** True when a firm bet is analytically supported AND not veto-blocked. */
  betEligible: boolean;
  /** Human-readable PASS/demotion reason, when applicable. */
  passReason?: string;
  /** Same-player/same-game conflicts against other shortlisted picks. */
  conflicts: string[];
}

export interface SelectorSummary {
  total: number;
  counts: Record<PickTier, number>;
  gradeCounts: Record<PickGrade, number>;
  /** Average edge across non-PASS (qualified) picks; null when none qualify. */
  averageEdge: number | null;
  marketBreakdown: { market: string; count: number }[];
}

export interface PickSelectorResult {
  picks: GradedPick[]; // ranked, best first
  groups: Record<PickTier, GradedPick[]>;
  summary: SelectorSummary;
  filters: PickSelectorFilters;
  scoreVersion: string;
}

/** Firm decisions that categorically block a bet (veto-respecting). */
function isBlocked(d: AnyDecision): boolean {
  return d === "NO_BET" || d === "UNAVAILABLE";
}

/** Edge over the even pick'em breakeven. Never negative for the favored side. */
export function edgeOf(c: SelectorCandidate): number {
  return Math.max(0, c.selectedSideProbability - 0.5);
}

/** Deterministic 0..100 quality score. Pure function of the candidate facts.
    Conviction saturates at a 0.75 favored-side probability — an exceptional
    edge for a PrizePicks pick'em line — so realistic strong edges reach the top
    grades rather than being compressed into the low end. */
export function scorePick(c: SelectorCandidate, conflictRisk: number): number {
  const probEdge = clamp((c.selectedSideProbability - 0.5) / 0.25, 0, 1);
  const raw =
    W.probEdge * probEdge +
    W.dataQuality * clamp(c.dataQuality, 0, 1) +
    W.confidence * clamp(c.confidence, 0, 1) +
    W.lineupCertainty * (c.lineupConfirmed ? 1 : 0.4) -
    W.uncertaintyPenalty * clamp(c.uncertainty, 0, 1) -
    W.conflictPenalty * clamp(conflictRisk, 0, 1);
  return Math.round(clamp(raw, 0, 1) * 1000) / 10; // one decimal, 0..100
}

function gradeFromScore(score: number): PickGrade {
  if (score >= 85) return "A+";
  if (score >= 72) return "A";
  if (score >= 58) return "B";
  if (score >= 45) return "C";
  return "PASS";
}

function tierForGrade(g: PickGrade): PickTier {
  switch (g) {
    case "A+": return "TOP";
    case "A": return "STRONG";
    case "B": return "PLAYABLE";
    case "C": return "WATCH";
    case "PASS": return "PASS";
  }
}

const ALL_TIERS: PickTier[] = ["TOP", "STRONG", "PLAYABLE", "WATCH", "PASS"];
const ALL_GRADES: PickGrade[] = ["A+", "A", "B", "C", "PASS"];

/** The first unmet hard filter for a candidate, or null if all pass. */
function filterFailure(c: SelectorCandidate, f: PickSelectorFilters): string | null {
  if (f.markets && f.markets.length > 0 && !f.markets.includes(c.market)) return null; // excluded market → silently dropped upstream
  if (c.selectedSideProbability < f.minProbability) return "projection too close to line (below min probability)";
  if (edgeOf(c) < f.minEdge) return "insufficient edge";
  if (c.dataQuality < f.minDataQuality) return "data quality below threshold";
  if (c.uncertainty > f.maxUncertainty) return "uncertainty too high";
  if (f.requireLineupConfirmed && !c.lineupConfirmed) return "lineup not confirmed";
  return null;
}

/**
 * Run the selector over a board of candidate props. Pure + deterministic.
 * Order of operations: conflicts → score → filter (incl. per-player/per-game
 * caps applied to the RANKED order) → grade → group → summarize.
 */
export function runPickSelector(
  candidates: SelectorCandidate[],
  overrides: Partial<PickSelectorFilters> = {},
): PickSelectorResult {
  const filters: PickSelectorFilters = { ...DEFAULT_SELECTOR_FILTERS, ...overrides };

  // Market filter drops non-selected markets entirely (they never appear).
  const pool = filters.markets && filters.markets.length > 0
    ? candidates.filter((c) => filters.markets!.includes(c.market))
    : candidates.slice();

  // 1. Conflicts from market relationships (same player/game only). No
  //    re-simulation: reuse the entry engine's contradiction rules.
  const conflictNotes = new Map<string, string[]>();
  const conflictRisk = new Map<string, number>();
  for (let i = 0; i < pool.length; i++) {
    for (let j = i + 1; j < pool.length; j++) {
      const a = pool[i], b = pool[j];
      if (a.playerId !== b.playerId || a.gamePk !== b.gamePk) continue;
      const refA: LegRef = { id: a.id, label: legLabel(a), playerId: a.playerId, gamePk: a.gamePk, market: a.market, direction: a.direction };
      const refB: LegRef = { id: b.id, label: legLabel(b), playerId: b.playerId, gamePk: b.gamePk, market: b.market, direction: b.direction };
      const { contradiction, note } = detectContradiction(refA, refB, 0);
      if (contradiction) {
        pushMap(conflictNotes, a.id, `${legLabel(b)}: ${note}`);
        pushMap(conflictNotes, b.id, `${legLabel(a)}: ${note}`);
        conflictRisk.set(a.id, Math.max(conflictRisk.get(a.id) ?? 0, 0.6));
        conflictRisk.set(b.id, Math.max(conflictRisk.get(b.id) ?? 0, 0.6));
      } else {
        // same player/game but not contradictory → shared-usage exposure (mild).
        conflictRisk.set(a.id, Math.max(conflictRisk.get(a.id) ?? 0, 0.2));
        conflictRisk.set(b.id, Math.max(conflictRisk.get(b.id) ?? 0, 0.2));
      }
    }
  }

  // 2. Score every candidate.
  const scored = pool.map((c) => {
    const risk = conflictRisk.get(c.id) ?? 0;
    const score = scorePick(c, risk);
    return { candidate: c, edge: edgeOf(c), score, conflicts: conflictNotes.get(c.id) ?? [] };
  });

  // 3. Rank by score desc (deterministic tiebreak by probability then id).
  scored.sort((x, y) =>
    y.score - x.score ||
    y.candidate.selectedSideProbability - x.candidate.selectedSideProbability ||
    x.candidate.id.localeCompare(y.candidate.id),
  );

  // 4. Grade + filter (per-player / per-game caps applied to the RANKED order so
  //    the strongest survive the cap; weaker duplicates demote to PASS).
  const perPlayer = new Map<number, number>();
  const perGame = new Map<number, number>();
  const picks: GradedPick[] = scored.map((s) => {
    const c = s.candidate;
    let passReason: string | undefined;

    // Hard filters first.
    const ff = filterFailure(c, filters);
    if (ff) passReason = ff;

    // Veto-respecting: a firm block can never grade above PASS.
    if (!passReason && isBlocked(c.decision)) {
      passReason = c.decision === "UNAVAILABLE" ? "unavailable — missing dependency" : "firm NO_BET (veto)";
    }

    // Per-player / per-game caps (only counted among otherwise-qualified picks).
    if (!passReason) {
      const pc = perPlayer.get(c.playerId) ?? 0;
      const gc = c.gamePk !== undefined ? perGame.get(c.gamePk) ?? 0 : 0;
      if (pc >= filters.maxSamePlayer) passReason = `max ${filters.maxSamePlayer} pick(s) per player already selected`;
      else if (c.gamePk !== undefined && gc >= filters.maxSameGame) passReason = `max ${filters.maxSameGame} pick(s) per game already selected`;
    }

    let grade: PickGrade;
    if (passReason) {
      grade = "PASS";
    } else {
      grade = gradeFromScore(s.score);
      if (grade === "PASS") passReason = "score below playable threshold";
    }

    // A firm WAIT can still grade on quality but is never bet-eligible.
    const betEligible = grade !== "PASS" && (c.decision === "BET_MORE" || c.decision === "BET_LESS");

    if (grade !== "PASS") {
      perPlayer.set(c.playerId, (perPlayer.get(c.playerId) ?? 0) + 1);
      if (c.gamePk !== undefined) perGame.set(c.gamePk, (perGame.get(c.gamePk) ?? 0) + 1);
    }

    return { candidate: c, edge: s.edge, score: s.score, grade, tier: tierForGrade(grade), betEligible, passReason, conflicts: s.conflicts };
  });

  // 5. Group + summarize.
  const groups = Object.fromEntries(ALL_TIERS.map((t) => [t, [] as GradedPick[]])) as Record<PickTier, GradedPick[]>;
  for (const p of picks) groups[p.tier].push(p);

  const counts = Object.fromEntries(ALL_TIERS.map((t) => [t, groups[t].length])) as Record<PickTier, number>;
  const gradeCounts = Object.fromEntries(ALL_GRADES.map((g) => [g, 0])) as Record<PickGrade, number>;
  for (const p of picks) gradeCounts[p.grade]++;

  const qualified = picks.filter((p) => p.grade !== "PASS");
  const averageEdge = qualified.length
    ? Math.round((qualified.reduce((a, p) => a + p.edge, 0) / qualified.length) * 1000) / 1000
    : null;

  const marketMap = new Map<string, number>();
  for (const c of pool) marketMap.set(c.market, (marketMap.get(c.market) ?? 0) + 1);
  const marketBreakdown = [...marketMap.entries()]
    .map(([market, count]) => ({ market, count }))
    .sort((a, b) => b.count - a.count);

  return {
    picks,
    groups,
    summary: { total: picks.length, counts, gradeCounts, averageEdge, marketBreakdown },
    filters,
    scoreVersion: SELECTOR_SCORE_VERSION,
  };
}

/**
 * Adapt a decision-engine `DecisionResult` (per-leg) into a `SelectorCandidate`.
 * The favored side and its probability come straight from the decision's
 * probabilities; no re-projection. Missing scores degrade honestly (unknown
 * data quality → 0.5 neutral; unknown fragility → 0.5), never fabricated as 0.
 */
export function fromDecisionResult(
  d: DecisionResult,
  opts: { id: string; playerName: string; lineupConfirmed: boolean; marketLabel?: string },
): SelectorCandidate | null {
  if (d.subjectType !== "LEG" || d.market === undefined || d.line === undefined) return null;
  const pMore = d.probabilityMore ?? 0.5;
  const pLess = d.probabilityLess ?? 1 - pMore;
  const direction: PickDirection = pMore >= pLess ? "more" : "less";
  const selectedSideProbability = d.selectedSideProbability ?? Math.max(pMore, pLess);
  // Fragility/volatility are 0..1 "worse is higher"; prefer fragility.
  const uncertainty = d.fragilityScore ?? d.volatilityScore ?? 0.5;
  return {
    id: opts.id,
    playerId: d.playerId ?? -1,
    playerName: opts.playerName,
    gamePk: d.gamePk,
    market: d.market,
    marketLabel: opts.marketLabel,
    line: d.line,
    direction,
    selectedSideProbability: clamp(selectedSideProbability, 0.5, 1),
    dataQuality: clamp(d.dataQualityScore ?? 0.5, 0, 1),
    confidence: clamp(d.confidenceScore ?? 0.5, 0, 1),
    uncertainty: clamp(uncertainty, 0, 1),
    decision: d.decision,
    lineupConfirmed: opts.lineupConfirmed,
    reasons: d.reasons.map((r) => r.message),
  };
}

function legLabel(c: SelectorCandidate): string {
  return `${c.playerName} ${c.direction.toUpperCase()} ${c.line} ${c.marketLabel ?? c.market}`;
}
function pushMap(m: Map<string, string[]>, k: string, v: string): void {
  const arr = m.get(k) ?? [];
  arr.push(v);
  m.set(k, arr);
}
