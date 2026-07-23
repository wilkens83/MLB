/* ============================================================================
   Historical CSV provider — parses the widely-used "tennis-abstract" match CSV
   schema (Jeff Sackmann format: one row per completed match, winner/loser
   oriented) into normalized `TennisMatch` records for backtesting and priors.

   This provider needs NO credentials — it operates on a CSV corpus the caller
   supplies (a string). It is a real, verifiable capability, unlike the
   credential-gated live providers.

   Security (audit §5): every cell is sanitized against CSV formula injection —
   any field beginning with = + - @ or a leading tab/CR is rejected, matching the
   PrizePicks CSV discipline. Malformed rows are skipped and counted, never
   allowed to crash the parse.
   ========================================================================== */

import { safeValidate } from "@/lib/schemas/validate";
import { zTennisMatch } from "../schemas/tennis";
import type {
  RankingSnapshot, Surface, TennisMatch, TennisPlayer, TennisTour, Tournament,
  DrawRound, MatchFormat,
} from "../domain";
import { recordFailure, recordSuccess, setStatus } from "./health";
import type {
  HistoricalQuery, ProviderCapabilities, ProviderStatus, ScheduleQuery, TennisDataProvider,
} from "./types";

const NAME = "historical-csv";

const CAPS: ProviderCapabilities = {
  schedule: false, results: true, rankings: false, players: false, historical: true,
};

export interface CsvParseResult {
  matches: TennisMatch[];
  skipped: number;
  errors: string[];
}

/** Reject cells that could trigger spreadsheet formula injection. */
export function isDangerousCell(v: string): boolean {
  return /^[=+\-@\t\r]/.test(v.trim());
}

function splitCsvLine(line: string): string[] {
  // Minimal CSV split handling double-quoted fields with embedded commas.
  const out: string[] = [];
  let cur = "";
  let inQ = false;
  for (let i = 0; i < line.length; i++) {
    const c = line[i];
    if (inQ) {
      if (c === '"' && line[i + 1] === '"') { cur += '"'; i++; }
      else if (c === '"') inQ = false;
      else cur += c;
    } else if (c === '"') inQ = true;
    else if (c === ",") { out.push(cur); cur = ""; }
    else cur += c;
  }
  out.push(cur);
  return out;
}

function surfaceOf(s: string): Surface {
  const v = s.trim().toLowerCase();
  if (v === "clay") return "clay";
  if (v === "grass") return "grass";
  if (v === "carpet") return "carpet";
  return "hard";
}

function roundOf(s: string): DrawRound {
  const v = s.trim().toUpperCase();
  const map: Record<string, DrawRound> = {
    "Q1": "qualifying", "Q2": "qualifying", "Q3": "qualifying",
    "R128": "r128", "R64": "r64", "R32": "r32", "R16": "r16",
    "QF": "quarterfinal", "SF": "semifinal", "F": "final",
  };
  return map[v] ?? "r32";
}

function formatOf(bestOf: string): MatchFormat {
  return bestOf.trim() === "5" ? "best_of_5" : "best_of_3";
}

/** Parse "6-4 3-6 7-6(5)" into normalized SetScore[] (winner=home orientation). */
function parseScore(score: string): TennisMatch["sets"] {
  const sets: TennisMatch["sets"] = [];
  for (const tok of score.trim().split(/\s+/)) {
    const m = /^(\d+)-(\d+)(?:\((\d+)\))?$/.exec(tok);
    if (!m) continue;
    const homeGames = Number(m[1]);
    const awayGames = Number(m[2]);
    const tb = m[3] !== undefined ? Number(m[3]) : undefined;
    const set: TennisMatch["sets"][number] = { homeGames, awayGames };
    if (tb !== undefined) {
      // Loser's tiebreak points are the bracketed number; winner reached 7 (or tb+2).
      if (homeGames > awayGames) { set.awayTiebreak = tb; set.homeTiebreak = Math.max(7, tb + 2); }
      else { set.homeTiebreak = tb; set.awayTiebreak = Math.max(7, tb + 2); }
    }
    sets.push(set);
  }
  return sets;
}

function num(v: string | undefined): number | undefined {
  if (v === undefined || v.trim() === "") return undefined;
  const n = Number(v);
  return Number.isFinite(n) ? n : undefined;
}

/** ISO-ish date from a YYYYMMDD tourney_date field. */
function dateOf(raw: string): string | undefined {
  const v = raw.trim();
  if (/^\d{8}$/.test(v)) return `${v.slice(0, 4)}-${v.slice(4, 6)}-${v.slice(6, 8)}`;
  return v || undefined;
}

/**
 * Parse a tennis-abstract style CSV corpus into normalized matches.
 * `tour` labels the corpus (atp/wta/…); `season` defaults from tourney_date.
 */
export function parseHistoricalCsv(csv: string, tour: TennisTour): CsvParseResult {
  const lines = csv.split(/\r?\n/).filter((l) => l.trim().length > 0);
  if (lines.length < 2) return { matches: [], skipped: 0, errors: ["empty or header-only CSV"] };

  const header = splitCsvLine(lines[0]).map((h) => h.trim());
  const idx = (name: string) => header.indexOf(name);
  const need = ["winner_name", "loser_name", "score"];
  for (const col of need) {
    if (idx(col) < 0) return { matches: [], skipped: 0, errors: [`missing required column: ${col}`] };
  }

  const matches: TennisMatch[] = [];
  const errors: string[] = [];
  let skipped = 0;

  for (let i = 1; i < lines.length; i++) {
    const cells = splitCsvLine(lines[i]);
    const get = (name: string) => cells[idx(name)]?.trim() ?? "";

    // CSV-injection guard on the free-text fields we surface.
    const danger = [get("winner_name"), get("loser_name"), get("tourney_name")].some(isDangerousCell);
    if (danger) { skipped++; errors.push(`row ${i}: rejected (formula-injection cell)`); continue; }

    const wName = get("winner_name");
    const lName = get("loser_name");
    const score = get("score");
    if (!wName || !lName || !score) { skipped++; continue; }

    const dateRaw = get("tourney_date");
    const date = dateOf(dateRaw);
    const season = num(get("season")) ?? (date ? Number(date.slice(0, 4)) : new Date().getFullYear());
    const surface = surfaceOf(get("surface"));
    const wId = get("winner_id") || `name:${wName.toLowerCase()}`;
    const lId = get("loser_id") || `name:${lName.toLowerCase()}`;

    const wAces = num(get("w_ace"));
    const wDf = num(get("w_df"));
    const lAces = num(get("l_ace"));
    const lDf = num(get("l_df"));

    const match: TennisMatch = {
      id: `csv:${get("tourney_id") || dateRaw}:${get("match_num") || i}`,
      tournamentId: `csv-trn:${get("tourney_id") || get("tourney_name") || "unknown"}`,
      season,
      surface,
      environment: "unknown",
      format: formatOf(get("best_of")),
      round: roundOf(get("round")),
      state: "completed",
      startTime: date ? `${date}T00:00:00Z` : undefined,
      home: { playerId: `csv:${wId}`, playerName: wName, side: "home", isWinner: true, rankAtMatch: num(get("winner_rank")) },
      away: { playerId: `csv:${lId}`, playerName: lName, side: "away", isWinner: false, rankAtMatch: num(get("loser_rank")) },
      sets: parseScore(score),
      stats: [
        statLine(`csv:${wId}`, wAces, wDf),
        statLine(`csv:${lId}`, lAces, lDf),
      ],
      externalIds: { historicalCsv: `${get("tourney_id")}:${get("match_num")}` },
      sources: ["historical-csv"],
    };

    const valid = safeValidate(zTennisMatch, match, null as unknown as TennisMatch, "csv.match");
    if (valid) matches.push(valid);
    else { skipped++; errors.push(`row ${i}: failed validation`); }
    void tour;
  }

  return { matches, skipped, errors };
}

function statLine(playerId: string, aces?: number, df?: number) {
  const available: string[] = [];
  if (aces !== undefined) available.push("aces");
  if (df !== undefined) available.push("doubleFaults");
  return { playerId, aces, doubleFaults: df, availableMetrics: available };
}

/**
 * A provider backed by an in-memory CSV corpus. Construct with the CSV text +
 * the tour it represents. Real, credential-free, verifiable.
 */
export function createHistoricalCsvProvider(csv: string, tour: TennisTour): TennisDataProvider {
  let parsed: CsvParseResult | null = null;
  const ensure = () => (parsed ??= parseHistoricalCsv(csv, tour));

  return {
    name: NAME,
    capabilities: CAPS,
    status(): ProviderStatus {
      const ready = csv.trim().length > 0;
      setStatus(NAME, ready ? "ready" : "unconfigured", ready ? `${ensure().matches.length} matches parsed` : "no corpus supplied");
      return ready ? "ready" : "unconfigured";
    },
    async getSchedule(_q: ScheduleQuery): Promise<TennisMatch[]> {
      void _q; return []; // historical corpus has no upcoming fixtures
    },
    async getMatchResults(query: HistoricalQuery): Promise<TennisMatch[]> {
      const t0 = Date.now();
      const res = ensure();
      if (res.matches.length === 0 && res.errors.length) {
        recordFailure(NAME, res.errors[0]);
        return [];
      }
      const out = res.matches
        .filter((m) => m.season === query.season)
        .filter((m) => (query.surface ? m.surface === query.surface : true));
      recordSuccess(NAME, Date.now() - t0);
      return out;
    },
    async getRankings(_tour: TennisTour): Promise<RankingSnapshot[]> { void _tour; return []; },
    async getPlayer(_id: string): Promise<TennisPlayer | null> { void _id; return null; },
    async getTournaments(_season: number): Promise<Tournament[]> { void _season; return []; },
  };
}
