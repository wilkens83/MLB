/* ============================================================================
   Canonical PrizePicks line snapshot — the validated, persistable unit produced
   by `prizepicks-import@1`. Every imported line becomes ONE of these, carrying
   provenance and a SERVER-DERIVED verification status. It reuses the existing
   PrizePicks domain (`../types`) — this is the ingestion adapter, not a second
   architecture.

   Line lifecycle (server-derived — the browser can NEVER set VERIFIED):
     IMPORTED       parsed + canonicalized + resolved + valid; awaiting review
     NEEDS_REVIEW   ambiguous player / doubleheader / unknown game / unknown market role
     VERIFIED       a trusted reviewer confirmed it (only via the review gate)
     REJECTED       invalid market or invalid line
   ========================================================================== */

import type { ProjectionType, PrizePicksSourceType } from "../types";

export type LineVerificationStatus = "IMPORTED" | "NEEDS_REVIEW" | "VERIFIED" | "REJECTED";

export interface CanonicalLineSnapshot {
  /** Stable identity across line CHANGES: (boardDate, normalizedPlayer, market). */
  entryId: string;
  boardDate: string;
  playerName: string; // normalized display name (raw preserved in rawPlayerName)
  rawPlayerName: string;
  playerId?: number; // resolved MLB id — omitted when unresolved (never guessed)
  gamePk?: number; // resolved game — omitted when unknown/ambiguous (never invented)
  gameNumber?: number; // doubleheader game number when disambiguated
  marketKey: string; // canonical prop key (from market-map)
  rawMarketLabel: string;
  marketSupported: boolean;
  line: number;
  projectionType: ProjectionType;
  capturedAt: string; // ISO
  source: PrizePicksSourceType;
  sourceReference?: string;
  verificationStatus: LineVerificationStatus;
  /** Idempotency key over the identifying line content (see `lineInputHash`). */
  inputHash: string;
  /** Hash of the snapshot this one supersedes (a changed line), when applicable. */
  supersedesHash?: string;
  /** Why the line is NEEDS_REVIEW / REJECTED (audit). */
  reason?: string;
}

/** Deterministic, dependency-free stable hash (djb2/xor) — no crypto import. */
export function stableHash(value: unknown): string {
  const s = JSON.stringify(value);
  let h = 5381;
  for (let i = 0; i < s.length; i++) h = ((h * 33) ^ s.charCodeAt(i)) >>> 0;
  return h.toString(16).padStart(8, "0");
}

const norm = (s: string) => s.trim().toLowerCase().replace(/\s+/g, " ");

/** Stable entry identity — the SAME across line changes, so versions supersede. */
export function lineEntryId(boardDate: string, normalizedPlayerName: string, marketKey: string): string {
  return `${boardDate}|${norm(normalizedPlayerName)}|${marketKey}`;
}

/**
 * Idempotency hash over the IDENTIFYING content of a line: board date, player,
 * market, line value, projection type. Source/provenance is intentionally
 * excluded so re-importing the exact same line (from any source) is a no-op,
 * while any change to the line or projection type yields a new snapshot.
 */
export function lineInputHash(args: {
  boardDate: string;
  normalizedPlayerName: string;
  marketKey: string;
  line: number;
  projectionType: ProjectionType;
}): string {
  return stableHash({
    d: args.boardDate,
    p: norm(args.normalizedPlayerName),
    m: args.marketKey,
    l: args.line,
    t: args.projectionType,
  });
}
