/* ============================================================================
   Independent verification of Tennis provider records. These are DETERMINISTIC
   invariant checks that re-derive correctness from the data itself — they never
   ask the adapter that produced a record whether it is valid (audit: no fake
   `compare(value, value)` cross-checks). A REJECT prevents data from entering the
   pipeline / predictive features.

   Pure: imports only domain types. Runs under Bun and in the browser.
   ========================================================================== */

import type { RankingSnapshot, TennisMatch } from "../domain";

export type Verdict = "PASS" | "WARN" | "REJECT";

export interface VerifyIssue {
  code: string;
  severity: "warn" | "reject";
  detail: string;
  /** Record id the issue attaches to, when applicable. */
  ref?: string;
}

export interface VerifyReport {
  verdict: Verdict;
  issues: VerifyIssue[];
  /** Count of records that passed with no reject-level issue. */
  passed: number;
  total: number;
}

function worst(issues: VerifyIssue[]): Verdict {
  if (issues.some((i) => i.severity === "reject")) return "REJECT";
  if (issues.length > 0) return "WARN";
  return "PASS";
}

/** A completed match must have a coherent winner/score relationship. */
function checkMatch(m: TennisMatch, issues: VerifyIssue[]): boolean {
  let rejected = false;
  const reject = (code: string, detail: string) => { issues.push({ code, severity: "reject", detail, ref: m.id }); rejected = true; };
  const warn = (code: string, detail: string) => issues.push({ code, severity: "warn", detail, ref: m.id });

  // Identity: valid, distinct player ids; a player never plays themselves.
  if (!m.home.playerId || !m.away.playerId) reject("MISSING_PLAYER_ID", "a side has no player id");
  else if (m.home.playerId === m.away.playerId) reject("PLAYER_VS_SELF", `both sides are ${m.home.playerId}`);

  // Provenance: at least one source provider recorded.
  const providers = m.sources.filter((s) => !s.includes(":"));
  if (providers.length === 0) reject("NO_PROVENANCE", "no source provider on record");

  const completed = m.state === "completed" || m.state === "retired";
  if (completed) {
    // Impossible set scores (a set is won at 6/7 games barring long formats; guard obvious corruption).
    for (const s of m.sets) {
      if (s.homeGames < 0 || s.awayGames < 0) reject("NEGATIVE_GAMES", `set ${s.homeGames}-${s.awayGames}`);
      if (s.homeGames > 30 || s.awayGames > 30) reject("IMPOSSIBLE_SET", `set ${s.homeGames}-${s.awayGames}`);
    }
    // Winner must correspond to sets won, unless retirement/walkover explains it.
    const homeWon = m.sets.filter((s) => s.homeGames > s.awayGames).length;
    const awayWon = m.sets.filter((s) => s.awayGames > s.homeGames).length;
    const declaredHome = m.home.isWinner === true;
    const declaredAway = m.away.isWinner === true;
    if (m.state === "completed" && m.sets.length > 0 && (declaredHome || declaredAway)) {
      const scoreFavorsHome = homeWon > awayWon;
      const scoreFavorsAway = awayWon > homeWon;
      if (declaredHome && scoreFavorsAway) reject("WINNER_SCORE_MISMATCH", "home declared winner but lost more sets");
      if (declaredAway && scoreFavorsHome) reject("WINNER_SCORE_MISMATCH", "away declared winner but lost more sets");
    }
    if (m.state === "completed" && m.sets.length === 0) warn("NO_SETS_ON_COMPLETED", "completed match has no set scores");
  }

  if (m.sources.includes("surface:unresolved")) warn("SURFACE_UNRESOLVED", "surface defaulted, not provider-confirmed");
  return !rejected;
}

/** Verify a batch of matches; duplicates within the batch are a reject-level issue. */
export function verifyMatches(matches: TennisMatch[]): VerifyReport {
  const issues: VerifyIssue[] = [];
  const seen = new Set<string>();
  let passed = 0;
  for (const m of matches) {
    if (seen.has(m.id)) issues.push({ code: "DUPLICATE_MATCH_ID", severity: "reject", detail: m.id, ref: m.id });
    seen.add(m.id);
    if (checkMatch(m, issues)) passed++;
  }
  return { verdict: worst(issues), issues, passed, total: matches.length };
}

/** Verify rankings: positive integer ranks, no future publication, no dup ranks per tour. */
export function verifyRankings(rankings: RankingSnapshot[], opts: { featureCutoff?: string } = {}): VerifyReport {
  const issues: VerifyIssue[] = [];
  const rankByTour = new Map<string, Set<number>>();
  let passed = 0;
  const cutoff = opts.featureCutoff ? Date.parse(opts.featureCutoff) : undefined;
  for (const r of rankings) {
    let ok = true;
    const reject = (code: string, detail: string) => { issues.push({ code, severity: "reject", detail, ref: r.playerId }); ok = false; };
    if (!Number.isInteger(r.rank) || r.rank <= 0) reject("INVALID_RANK", `rank=${r.rank}`);
    if (r.points !== undefined && r.points < 0) reject("NEGATIVE_POINTS", `points=${r.points}`);
    if (cutoff !== undefined && Date.parse(r.asOf) > cutoff) {
      reject("FUTURE_RANKING", `asOf ${r.asOf} > cutoff ${opts.featureCutoff}`); // no leakage into features
    }
    const key = r.tour;
    if (!rankByTour.has(key)) rankByTour.set(key, new Set());
    const set = rankByTour.get(key)!;
    if (set.has(r.rank)) issues.push({ code: "DUPLICATE_RANK", severity: "warn", detail: `${key} rank ${r.rank}`, ref: r.playerId });
    set.add(r.rank);
    if (ok) passed++;
  }
  return { verdict: worst(issues), issues, passed, total: rankings.length };
}

/** Convenience predicate for the provider factory: did a batch clear REJECT? */
export function matchesAcceptable(matches: TennisMatch[]): boolean {
  return verifyMatches(matches).verdict !== "REJECT";
}

export function rankingsAcceptable(rankings: RankingSnapshot[]): boolean {
  return verifyRankings(rankings).verdict !== "REJECT";
}
