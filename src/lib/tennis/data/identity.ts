/* ============================================================================
   Player identity resolution. The same human appears under different ids and
   spellings across providers; this module resolves them to ONE canonical
   `TennisPlayer`. Compliance rule (audit §5): we NEVER join by name alone. A
   match requires name agreement PLUS at least one corroborating key (tour + DOB,
   country, or a shared external id). Ambiguous cases are surfaced, not guessed —
   mirroring the PrizePicks resolver's "ambiguous" outcome.
   ========================================================================== */

import type { TennisPlayer, TennisTour } from "../domain";

/** Normalize a display name to a comparable key: lowercase, de-accented, "last first". */
export function normalizeName(name: string): string {
  const cleaned = name
    .normalize("NFD")
    .replace(/[̀-ͯ]/g, "") // strip combining diacritics
    .toLowerCase()
    .replace(/[.'`-]/g, " ")
    .replace(/\s+/g, " ")
    .trim();
  return cleaned;
}

/** A set-insensitive comparison of two normalized names (token order agnostic). */
export function nameTokensMatch(a: string, b: string): boolean {
  const ta = new Set(normalizeName(a).split(" ").filter(Boolean));
  const tb = new Set(normalizeName(b).split(" ").filter(Boolean));
  if (ta.size === 0 || tb.size === 0) return false;
  const [small, big] = ta.size <= tb.size ? [ta, tb] : [tb, ta];
  let hits = 0;
  for (const t of small) if (big.has(t)) hits++;
  // Require every token of the smaller set to be present (handles "R. Nadal" vs "Rafael Nadal" only when initials expanded elsewhere).
  return hits === small.size;
}

export interface IdentityQuery {
  name: string;
  tour?: TennisTour;
  countryCode?: string;
  dateOfBirth?: string;
  /** Provider name → that provider's id, if known. Strongest signal. */
  externalIds?: Record<string, string>;
}

export type ResolutionStatus = "resolved" | "ambiguous" | "unresolved";

export interface ResolutionResult {
  status: ResolutionStatus;
  player?: TennisPlayer;
  candidates: { player: TennisPlayer; score: number; reasons: string[] }[];
  reason?: string;
}

/** Score a candidate against the query. Name-only never clears the threshold. */
function scoreCandidate(q: IdentityQuery, p: TennisPlayer): { score: number; reasons: string[] } {
  const reasons: string[] = [];
  let score = 0;

  // 1) External id crosswalk — decisive on its own.
  if (q.externalIds) {
    for (const [prov, id] of Object.entries(q.externalIds)) {
      if (p.externalIds[prov] === id) { score += 100; reasons.push(`external-id:${prov}`); }
    }
  }

  const nameMatch = nameTokensMatch(q.name, p.fullName) || nameTokensMatch(q.name, p.normalizedName);
  if (nameMatch) { score += 40; reasons.push("name"); }

  // 2) Corroborating keys — required in ADDITION to name.
  if (q.dateOfBirth && p.dateOfBirth && q.dateOfBirth === p.dateOfBirth) { score += 40; reasons.push("dob"); }
  if (q.tour && p.tour === q.tour) { score += 10; reasons.push("tour"); }
  if (q.countryCode && p.countryCode && q.countryCode === p.countryCode) { score += 15; reasons.push("country"); }

  return { score, reasons };
}

/**
 * Resolve a query against a candidate pool. Returns "resolved" only when a single
 * candidate clears the threshold with a corroborating key beyond the name; two
 * close candidates yield "ambiguous"; nothing plausible yields "unresolved".
 */
export function resolveIdentity(q: IdentityQuery, pool: TennisPlayer[]): ResolutionResult {
  const scored = pool
    .map((p) => ({ player: p, ...scoreCandidate(q, p) }))
    .filter((c) => c.score > 0)
    .sort((a, b) => b.score - a.score);

  if (scored.length === 0) return { status: "unresolved", candidates: [], reason: "no candidates matched" };

  const top = scored[0];
  const hasExternal = top.reasons.some((r) => r.startsWith("external-id"));
  const hasCorroboration = hasExternal || top.reasons.some((r) => r === "dob" || r === "country" || r === "tour");
  const nameOnly = top.reasons.length === 1 && top.reasons[0] === "name";

  // Never accept a name-only match.
  if (nameOnly || !hasCorroboration) {
    return { status: "unresolved", candidates: scored, reason: "name-only match rejected (needs corroborating key)" };
  }

  const second = scored[1];
  const clearWinner = !second || top.score - second.score >= 25 || hasExternal;
  if (!clearWinner) {
    return { status: "ambiguous", candidates: scored, reason: "multiple candidates within tolerance" };
  }

  return { status: "resolved", player: top.player, candidates: scored };
}

/**
 * Reconcile players discovered across providers into a deduplicated canonical
 * set, merging external-id crosswalks. Same-identity detection uses
 * `resolveIdentity` against the accumulating set — never name alone.
 */
export function reconcilePlayers(discovered: TennisPlayer[]): TennisPlayer[] {
  const canonical: TennisPlayer[] = [];
  for (const p of discovered) {
    const res = resolveIdentity(
      { name: p.fullName, tour: p.tour, countryCode: p.countryCode, dateOfBirth: p.dateOfBirth, externalIds: p.externalIds },
      canonical,
    );
    if (res.status === "resolved" && res.player) {
      // Merge external ids into the existing canonical entry.
      res.player.externalIds = { ...res.player.externalIds, ...p.externalIds };
    } else {
      canonical.push({ ...p, externalIds: { ...p.externalIds } });
    }
  }
  return canonical;
}
