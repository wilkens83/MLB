/* ============================================================================
   Player Picks ranking. Ranking is state-first: a QUALIFIED candidate always
   outranks a WATCH, which outranks REJECTED, which outranks UNAVAILABLE — within
   a state, by the experimental screening score. This guarantees a high raw
   probability with a poor state (e.g. extreme fragility → rejected) can never
   rank first. The system is allowed to return NO STRONG PICK.
   ========================================================================== */

import type { PlayerPickCandidate, PickDecision } from "./types";

const DECISION_RANK: Record<PickDecision, number> = {
  qualified: 0,
  watch: 1,
  rejected: 2,
  projection_only: 3,
  unavailable: 4,
};

/** Deterministic ordering: decision precedence, then score desc, then propKey. */
export function comparePicks(a: PlayerPickCandidate, b: PlayerPickCandidate): number {
  const dr = DECISION_RANK[a.decision] - DECISION_RANK[b.decision];
  if (dr !== 0) return dr;
  if (b.score !== a.score) return b.score - a.score;
  return a.propKey.localeCompare(b.propKey);
}

export interface RankedPicks {
  topPicks: PlayerPickCandidate[];
  allProps: PlayerPickCandidate[];
  projectionOnly: PlayerPickCandidate[];
  noStrongPick: boolean;
}

export function rankPicks(candidates: PlayerPickCandidate[], topN = 3): RankedPicks {
  const lineMode = candidates.filter((c) => c.decision !== "projection_only");
  // Rank projection-only performances by projection strength (strongest first),
  // falling back to prop key for a deterministic tie-break.
  const projectionOnly = candidates
    .filter((c) => c.decision === "projection_only")
    .sort((a, b) => (b.projectionScore ?? 0) - (a.projectionScore ?? 0) || a.propKey.localeCompare(b.propKey));

  const allProps = [...lineMode].sort(comparePicks);

  // Only QUALIFIED candidates can be a "best pick". No forced pick.
  const qualified = allProps.filter((c) => c.decision === "qualified");
  const topPicks = qualified.slice(0, topN);

  return {
    topPicks,
    allProps,
    projectionOnly,
    noStrongPick: topPicks.length === 0,
  };
}
