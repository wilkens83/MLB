/* ============================================================================
   Board providers (Phase 2). A provider turns some input (manual form, CSV
   text, reviewed image, …) into the SAME normalized board-entry format. The UI
   depends on this interface, not on any single ingestion method.
   ========================================================================== */

import { resolveMarket } from "./market-map";
import { normalizePlayerName, normalizeTeamAbbr } from "./normalize";
import { parseBoardCsv } from "./csv";
import type {
  PrizePicksBoardEntry, PrizePicksImportError, PrizePicksImportSession,
  PrizePicksSourceType, RawEntry,
} from "./types";

export interface ImportResult {
  session: PrizePicksImportSession;
  entries: PrizePicksBoardEntry[];
  errors: PrizePicksImportError[];
}

export interface BoardProvider {
  id: string;
  label: string;
  sourceType: PrizePicksSourceType;
  importBoard(input: string): Promise<ImportResult>;
}

let seq = 0;
function id(prefix: string) {
  seq += 1;
  return `${prefix}_${Date.now().toString(36)}_${seq}`;
}

/**
 * Convert a validated RawEntry into a normalized board entry (player still
 * unresolved — resolution is a separate reviewed step). Market is resolved when
 * unambiguous; ambiguous/unknown markets are marked for review, never guessed.
 */
export function buildBoardEntry(raw: RawEntry): PrizePicksBoardEntry {
  const market = resolveMarket(raw.rawMarketLabel);
  const resolvedMarket = market.status === "resolved" ? market.market! : undefined;

  return {
    id: id("ppe"),
    boardDate: raw.boardDate,
    capturedAt: raw.capturedAt,
    sourceType: raw.sourceType,
    sourceReference: raw.sourceReference,
    rawPlayerName: raw.rawPlayerName,
    normalizedPlayerName: normalizePlayerName(raw.rawPlayerName),
    // Carry canonical identity forward when the player was picked from the
    // autocomplete, so the resolve step trusts the id instead of re-searching.
    mlbPlayerId: raw.mlbPlayerId,
    mlbTeamId: raw.mlbTeamId,
    position: raw.position,
    resolvedTeamName: raw.resolvedTeamName,
    teamAbbreviation: normalizeTeamAbbr(raw.teamAbbreviation),
    opponentAbbreviation: normalizeTeamAbbr(raw.opponentAbbreviation),
    marketKey: resolvedMarket?.canonical ?? "",
    rawMarketLabel: raw.rawMarketLabel,
    marketSupported: resolvedMarket?.supported ?? false,
    line: raw.line,
    projectionType: raw.projectionType,
    // Additive source metadata (present for screenshot imports; omitted for
    // manual/CSV). Alternative thresholds and PP-displayed history are never
    // fed to the projection — they are display-only provenance.
    alternativeLines: raw.alternativeLines,
    sourceHistory: raw.sourceHistory,
    sourceAverageL5: raw.sourceAverageL5,
    gameStartTime: raw.gameStartTime,
    status: resolvedMarket ? "unresolved" : "invalid",
    snapshots: [
      { line: raw.line, projectionType: raw.projectionType, sourceType: raw.sourceType, capturedAt: raw.capturedAt },
    ],
    notes: market.status !== "resolved" ? `market needs review: ${market.reason}` : raw.notes,
  };
}

/** Manual provider — input is a JSON array of RawEntry (from the form). */
export const manualProvider: BoardProvider = {
  id: "manual",
  label: "Manual entry",
  sourceType: "manual",
  async importBoard(input: string): Promise<ImportResult> {
    const errors: PrizePicksImportError[] = [];
    let raws: RawEntry[] = [];
    try {
      raws = JSON.parse(input) as RawEntry[];
    } catch {
      errors.push({ row: 0, message: "invalid manual payload" });
    }
    const entries = raws.map(buildBoardEntry);
    return {
      session: {
        id: id("sess"), sourceType: "manual", createdAt: new Date().toISOString(),
        imported: entries.length, rejected: errors.length, errors,
      },
      entries,
      errors,
    };
  },
};

/** CSV provider — input is raw CSV text. */
export const csvProvider: BoardProvider = {
  id: "csv",
  label: "CSV import",
  sourceType: "csv",
  async importBoard(input: string): Promise<ImportResult> {
    const parsed = parseBoardCsv(input, { defaultCapturedAt: new Date().toISOString() });
    const entries = parsed.entries.map(buildBoardEntry);
    return {
      session: {
        id: id("sess"), sourceType: "csv", createdAt: new Date().toISOString(),
        imported: entries.length, rejected: parsed.errors.length, errors: parsed.errors,
      },
      entries,
      errors: parsed.errors,
    };
  },
};

/**
 * Screenshot (reviewed-image-import) provider — input is a JSON array of RawEntry
 * produced by the human-reviewed screenshot flow. It is deliberately identical to
 * the manual provider in shape (same normalized RawEntry → buildBoardEntry): a
 * screenshot is just another INPUT source that lands in the same pipeline after
 * mandatory review. Uncertain rows arrive already flagged (unknown market → the
 * shared normalizer marks them invalid/for review).
 */
export const screenshotProvider: BoardProvider = {
  id: "screenshot",
  label: "Screenshot import",
  sourceType: "reviewed-image-import",
  async importBoard(input: string): Promise<ImportResult> {
    const errors: PrizePicksImportError[] = [];
    let raws: RawEntry[] = [];
    try {
      raws = JSON.parse(input) as RawEntry[];
    } catch {
      errors.push({ row: 0, message: "invalid screenshot payload" });
    }
    const entries = raws.map(buildBoardEntry);
    return {
      session: {
        id: id("sess"), sourceType: "reviewed-image-import", createdAt: new Date().toISOString(),
        imported: entries.length, rejected: errors.length, errors,
      },
      entries,
      errors,
    };
  },
};

export const PROVIDERS: BoardProvider[] = [manualProvider, csvProvider, screenshotProvider];
