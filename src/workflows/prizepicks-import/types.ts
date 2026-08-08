/* Contracts for prizepicks-import@1. Reuses the existing PrizePicks CSV parser,
   market canonicalizer, and player/game resolver via injected deps so the graph
   is deterministically testable offline. Pure (zod + domain types). */

import { z } from "zod";
import type { RawEntry, MarketCategory, PrizePicksPlayerResolution, PlayerCandidate } from "@/lib/prizepicks/types";
import type { GameResolution } from "@/lib/prizepicks/player-resolver";
import type { LineSnapshotStore } from "@/lib/prizepicks/ingestion/snapshotStore";

/** A trusted review decision — supplied by a SERVER action, never the raw import.
    This is the only path that can move a line to VERIFIED (or force REJECTED). */
export const reviewDecisionSchema = z.object({
  entryId: z.string(),
  decision: z.enum(["VERIFIED", "REJECTED"]),
  reason: z.string().optional(),
});
export type ReviewDecision = z.infer<typeof reviewDecisionSchema>;

export const importInputSchema = z.object({
  boardDate: z.string().regex(/^\d{4}-\d{2}-\d{2}$/, "boardDate must be YYYY-MM-DD"),
  source: z.enum(["manual", "csv", "reviewed-image-import", "browser-assisted-import", "authorized-provider"]),
  sourceReference: z.string().optional(),
  /** Raw CSV text (csv source) — parsed by the existing parseBoardCsv. */
  csvText: z.string().optional(),
  /** Pre-parsed rows (manual / image-review path) — used when csvText is absent. */
  rows: z.array(z.custom<RawEntry>()).optional(),
  /** Trusted reviews to apply at the review gate. Absent ⇒ nothing is VERIFIED. */
  reviews: z.array(reviewDecisionSchema).optional(),
});
export type ImportInput = z.infer<typeof importInputSchema>;

export interface ImportDeps {
  resolvePlayer: (input: {
    rawPlayerName: string; boardDate: string; teamAbbreviation?: string; categoryHint?: MarketCategory;
  }) => Promise<PrizePicksPlayerResolution>;
  resolveGame: (player: PlayerCandidate, boardDate: string) => Promise<GameResolution>;
  store: LineSnapshotStore;
}

export const parseErrorSchema = z.object({
  row: z.number(), field: z.string().optional(), raw: z.string().optional(), message: z.string(),
});

export const importSummarySchema = z.object({
  parsed: z.number().int().nonnegative(),
  parseErrors: z.number().int().nonnegative(),
  duplicatesInFile: z.number().int().nonnegative(),
  imported: z.number().int().nonnegative(),
  needsReview: z.number().int().nonnegative(),
  verified: z.number().int().nonnegative(),
  rejected: z.number().int().nonnegative(),
  persisted: z.object({
    inserted: z.number().int().nonnegative(),
    superseded: z.number().int().nonnegative(),
    noop: z.number().int().nonnegative(),
  }),
});

export const importResultSchema = z.object({
  boardDate: z.string(),
  summary: importSummarySchema,
  snapshots: z.array(z.unknown()),
  parseErrors: z.array(parseErrorSchema),
});
export type ImportResult = z.infer<typeof importResultSchema>;
