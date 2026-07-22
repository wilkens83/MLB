/* ============================================================================
   CSV import — parse and validate a documented PrizePicks board CSV. Invalid
   rows are reported (never silently dropped); valid rows become RawEntry.
   Format:
     board_date,captured_at,player,team,opponent,market,line,projection_type,notes
   ========================================================================== */

import { rawEntrySchema, type RawEntry, type PrizePicksImportError } from "./types";
import { normalizeProjectionType, normalizeTeamAbbr } from "./normalize";

export const CSV_HEADER = "board_date,captured_at,player,team,opponent,market,line,projection_type,notes";

export const CSV_TEMPLATE = [
  CSV_HEADER,
  "2026-07-21,2026-07-21T16:05:00-04:00,Paul Skenes,PIT,CIN,Pitcher Strikeouts,6.5,standard,",
  "2026-07-21,2026-07-21T16:06:00-04:00,Aaron Judge,NYY,BOS,Total Bases,1.5,demon,",
].join("\n");

/** Parse a single CSV line honoring double-quoted fields. */
export function parseCsvLine(line: string): string[] {
  const out: string[] = [];
  let cur = "";
  let inQ = false;
  for (let i = 0; i < line.length; i++) {
    const c = line[i];
    if (inQ) {
      if (c === '"') {
        if (line[i + 1] === '"') { cur += '"'; i++; } else inQ = false;
      } else cur += c;
    } else if (c === '"') inQ = true;
    else if (c === ",") { out.push(cur); cur = ""; }
    else cur += c;
  }
  out.push(cur);
  return out.map((s) => s.trim());
}

export interface CsvParseResult {
  entries: RawEntry[];
  errors: PrizePicksImportError[];
  duplicates: number;
}

const REQUIRED = ["board_date", "captured_at", "player", "market", "line"];

/**
 * Parse a CSV string into validated RawEntry rows. `sourceReference` (e.g. file
 * name) is attached for provenance. `defaultCapturedAt` fills blank timestamps.
 */
export function parseBoardCsv(
  text: string,
  opts: { sourceReference?: string; defaultCapturedAt?: string } = {},
): CsvParseResult {
  const lines = text.replace(/\r\n/g, "\n").split("\n").filter((l) => l.trim().length > 0);
  const errors: PrizePicksImportError[] = [];
  const entries: RawEntry[] = [];
  if (lines.length === 0) return { entries, errors, duplicates: 0 };

  const header = parseCsvLine(lines[0]).map((h) => h.toLowerCase());
  const idx = (name: string) => header.indexOf(name);
  for (const req of REQUIRED) {
    if (idx(req) === -1) errors.push({ row: 0, field: req, message: `missing required column "${req}"` });
  }
  if (errors.length) return { entries, errors, duplicates: 0 };

  const seen = new Set<string>();
  let duplicates = 0;

  for (let r = 1; r < lines.length; r++) {
    const cells = parseCsvLine(lines[r]);
    const get = (name: string) => cells[idx(name)] ?? "";
    const lineNum = Number(get("line"));

    const raw = {
      boardDate: get("board_date"),
      capturedAt: get("captured_at") || opts.defaultCapturedAt || new Date().toISOString(),
      sourceType: "csv" as const,
      sourceReference: opts.sourceReference,
      rawPlayerName: get("player"),
      teamAbbreviation: normalizeTeamAbbr(get("team")),
      opponentAbbreviation: normalizeTeamAbbr(get("opponent")),
      rawMarketLabel: get("market"),
      line: Number.isFinite(lineNum) ? lineNum : NaN,
      projectionType: normalizeProjectionType(get("projection_type")),
      notes: get("notes") || undefined,
    };

    if (!Number.isFinite(raw.line)) {
      errors.push({ row: r, field: "line", raw: get("line"), message: "line is not a number" });
      continue;
    }

    const parsed = rawEntrySchema.safeParse(raw);
    if (!parsed.success) {
      const first = parsed.error.issues[0];
      errors.push({ row: r, field: first?.path?.join("."), raw: lines[r], message: first?.message ?? "invalid row" });
      continue;
    }

    const dupKey = `${parsed.data.boardDate}|${parsed.data.rawPlayerName.toLowerCase()}|${parsed.data.rawMarketLabel.toLowerCase()}|${parsed.data.line}`;
    if (seen.has(dupKey)) { duplicates++; continue; }
    seen.add(dupKey);
    entries.push(parsed.data);
  }

  return { entries, errors, duplicates };
}
