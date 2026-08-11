/* ============================================================================
   PrizePicks integration — normalized internal domain models + Zod schemas.
   This is an ADAPTER layer. It never feeds imported lines back into the
   projection; the line is only a threshold. See docs/prizepicks-integration/.
   ========================================================================== */

import { z } from "zod";

export type PrizePicksSourceType =
  | "manual"
  | "csv"
  | "reviewed-image-import"
  | "browser-assisted-import"
  | "authorized-provider";

export type ProjectionType = "standard" | "goblin" | "demon" | "unknown";

export type EntryStatus = "unresolved" | "resolved" | "ambiguous" | "invalid" | "archived";

export type MarketCategory = "hitter" | "pitcher";

/** A canonical market: maps to an existing catalog prop key. */
export interface PrizePicksMarket {
  /** Canonical internal prop identifier (must exist in props/catalog.ts). */
  canonical: string;
  category: MarketCategory;
  label: string;
  /** False when the engine cannot fully model it yet (routed to review/warn). */
  supported: boolean;
}

/** One captured line value with its provenance (append-only snapshots). */
export interface PrizePicksLineSnapshot {
  line: number;
  projectionType: ProjectionType;
  sourceType: PrizePicksSourceType;
  capturedAt: string; // ISO
  note?: string;
}

/**
 * An alternative threshold for the SAME canonical market. Goblin/Standard/Demon
 * lines are NOT separate props — they are the same underlying projection scored
 * at a different threshold. Preserved as PrizePicks source metadata.
 */
export interface PrizePicksAlternativeLine {
  line: number;
  projectionType: ProjectionType;
}

/**
 * A PrizePicks-displayed recent-history row (value / opponent / date). This is
 * SOURCE metadata shown on the card ONLY — it is never fed to the projection or
 * used as a substitute for official MLB game-log data.
 */
export interface PrizePicksHistoryPoint {
  value: number;
  opponent?: string;
  date?: string;
}

/** A normalized board entry — preserves original text, source and timestamps. */
export interface PrizePicksBoardEntry {
  id: string;
  boardDate: string; // YYYY-MM-DD
  capturedAt: string; // ISO
  sourceType: PrizePicksSourceType;
  sourceReference?: string;

  rawPlayerName: string;
  normalizedPlayerName: string;

  mlbPlayerId?: number;
  gamePk?: number;
  gameNumber?: number; // doubleheader game number when known

  teamAbbreviation?: string;
  opponentAbbreviation?: string;

  // Purely-visual resolution fields (populated after player resolution).
  mlbTeamId?: number;
  position?: string;
  resolvedTeamName?: string;
  opponentName?: string;

  marketKey: string; // canonical prop key
  rawMarketLabel: string;
  marketSupported: boolean;

  line: number;
  projectionType: ProjectionType;

  /**
   * Other thresholds captured for THIS market (goblin/demon variants). Source
   * metadata only — the primary `line` above is what the engine is scored at;
   * these are additional thresholds to display, never new props.
   */
  alternativeLines?: PrizePicksAlternativeLine[];
  /** PrizePicks-displayed recent history (source metadata; never a model input). */
  sourceHistory?: PrizePicksHistoryPoint[];
  /** PrizePicks-displayed last-5 average (source metadata; never a model input). */
  sourceAverageL5?: number;

  gameStartTime?: string;
  status: EntryStatus;

  /** Append-only line history (most recent last). */
  snapshots: PrizePicksLineSnapshot[];

  notes?: string;
  /** User corrections applied on top of the raw import, for provenance. */
  corrections?: Record<string, string>;
}

export interface PrizePicksImportError {
  row: number;
  field?: string;
  raw?: string;
  message: string;
}

export interface PrizePicksImportSession {
  id: string;
  sourceType: PrizePicksSourceType;
  createdAt: string;
  sourceReference?: string;
  imported: number;
  rejected: number;
  errors: PrizePicksImportError[];
}

export type ResolutionStatus = "resolved" | "ambiguous" | "not-found" | "conflicting";

export interface PlayerCandidate {
  mlbPlayerId: number;
  fullName: string;
  position: string;
  isPitcher: boolean;
  teamId?: number;
  teamName?: string;
  gamePk?: number;
  opponentName?: string;
}

export interface PrizePicksPlayerResolution {
  status: ResolutionStatus;
  candidates: PlayerCandidate[];
  chosen?: PlayerCandidate;
  reason: string;
}

/** Directional probabilities produced by the existing engine vs the line. */
export interface CandidateEvaluation {
  entryId: string;
  mlbPlayerId: number;
  gamePk?: number;
  marketKey: string;
  line: number;
  projection: number;
  median: number;
  probMore: number;
  probLess: number;
  probPush: number;
  projectionDiff: number; // projection - line
  /**
   * Directional probabilities for the SAME projection at each alternative
   * threshold (goblin/demon). Read from the model distribution the engine
   * already produced — the projection is identical; only the threshold moves.
   */
  alternativeLines?: {
    line: number;
    projectionType: ProjectionType;
    probMore: number;
    probLess: number;
  }[];
  hitRates: { l5: number; l10: number; l20: number; season: number };
  dataQuality: number;
  modelAgreement: number; // 0..1
  sampleSize: number;
  warnings: { code: string; severity: "info" | "warn" | "high" }[];
  modelVersion: string;
  calculatedAt: string;
  /** Whether this was computed before first pitch (eligible for backtesting). */
  pregame: boolean;
}

/** Immutable pregame snapshot (Phase 22) — never overwritten after game start. */
export interface PregameSnapshot extends CandidateEvaluation {
  lineCapturedAt: string;
  projectionType: ProjectionType;
  locked: true;
}

export type ResultGrade = "more" | "less" | "push" | "void";

export interface PrizePicksResult {
  entryId: string;
  marketKey: string;
  line: number;
  actual: number;
  grade: ResultGrade;
  gradedAt: string;
}

/* ---------------------------------------------------------------------------
   Zod schemas (boundary validation — malformed rows never reach analytics)
   ------------------------------------------------------------------------- */

export const projectionTypeSchema = z.enum(["standard", "goblin", "demon", "unknown"]);
export const sourceTypeSchema = z.enum([
  "manual", "csv", "reviewed-image-import", "browser-assisted-import", "authorized-provider",
]);

/** A raw, pre-normalization entry as produced by importers. */
export const rawEntrySchema = z.object({
  boardDate: z.string().regex(/^\d{4}-\d{2}-\d{2}$/, "boardDate must be YYYY-MM-DD"),
  capturedAt: z.string().min(1),
  sourceType: sourceTypeSchema,
  sourceReference: z.string().optional(),
  rawPlayerName: z.string().min(1, "player name required"),
  // Canonical MLB identity captured when the player was picked from the
  // autocomplete (additive — free-text entry omits these and is still valid).
  mlbPlayerId: z.number().int().positive().optional(),
  mlbTeamId: z.number().int().positive().optional(),
  position: z.string().optional(),
  resolvedTeamName: z.string().optional(),
  teamAbbreviation: z.string().optional(),
  opponentAbbreviation: z.string().optional(),
  rawMarketLabel: z.string().min(1, "market required"),
  line: z.number().finite().nonnegative().or(z.number().finite()), // some markets negative (spread); board markets are >=0
  projectionType: projectionTypeSchema.default("standard"),
  // Alternative thresholds + PrizePicks-displayed history (additive source
  // metadata; free-text/CSV entries omit these and stay valid).
  alternativeLines: z
    .array(z.object({ line: z.number().finite(), projectionType: projectionTypeSchema }))
    .optional(),
  sourceHistory: z
    .array(z.object({ value: z.number().finite(), opponent: z.string().optional(), date: z.string().optional() }))
    .optional(),
  sourceAverageL5: z.number().finite().optional(),
  gameStartTime: z.string().optional(),
  notes: z.string().optional(),
});

export type RawEntry = z.infer<typeof rawEntrySchema>;

export const boardEntrySchema: z.ZodType<PrizePicksBoardEntry> = z.object({
  id: z.string(),
  boardDate: z.string(),
  capturedAt: z.string(),
  sourceType: sourceTypeSchema,
  sourceReference: z.string().optional(),
  rawPlayerName: z.string(),
  normalizedPlayerName: z.string(),
  mlbPlayerId: z.number().optional(),
  gamePk: z.number().optional(),
  gameNumber: z.number().optional(),
  teamAbbreviation: z.string().optional(),
  opponentAbbreviation: z.string().optional(),
  mlbTeamId: z.number().optional(),
  position: z.string().optional(),
  resolvedTeamName: z.string().optional(),
  opponentName: z.string().optional(),
  marketKey: z.string(),
  rawMarketLabel: z.string(),
  marketSupported: z.boolean(),
  line: z.number(),
  projectionType: projectionTypeSchema,
  alternativeLines: z
    .array(z.object({ line: z.number(), projectionType: projectionTypeSchema }))
    .optional(),
  sourceHistory: z
    .array(z.object({ value: z.number(), opponent: z.string().optional(), date: z.string().optional() }))
    .optional(),
  sourceAverageL5: z.number().optional(),
  gameStartTime: z.string().optional(),
  status: z.enum(["unresolved", "resolved", "ambiguous", "invalid", "archived"]),
  snapshots: z.array(
    z.object({
      line: z.number(),
      projectionType: projectionTypeSchema,
      sourceType: sourceTypeSchema,
      capturedAt: z.string(),
      note: z.string().optional(),
    }),
  ),
  notes: z.string().optional(),
  corrections: z.record(z.string(), z.string()).optional(),
});
