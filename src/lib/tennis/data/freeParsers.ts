/* ============================================================================
   Smallest source-specific parsers for the Sackmann players + rankings files.
   Matches reuse `parseHistoricalCsv`; these two files (player bios, rankings
   time-series) are additional, so they get their own minimal parser — never a
   duplicate of the match parser.

   Discipline: player ids are `csv:<sackmann_id>` so they LINK to the match
   parser's `csv:<winner_id>` sides; missing fields stay `undefined` (a blank
   `points` column becomes `undefined`, never 0); free-text cells are guarded
   against CSV formula injection.
   ========================================================================== */

import type { Backhand, Plays, RankingSnapshot, TennisPlayer, TennisTour } from "../domain";
import { normalizeName } from "./identity";
import { isDangerousCell } from "../providers/historicalCsv";

function rows(csv: string): { header: string[]; data: string[][] } {
  const lines = csv.split(/\r?\n/).filter((l) => l.trim().length > 0);
  const split = (l: string) => l.split(",").map((c) => c.trim());
  if (lines.length < 2) return { header: [], data: [] };
  return { header: split(lines[0]), data: lines.slice(1).map(split) };
}

function isoFromYmd(v: string | undefined): string | undefined {
  if (!v || !/^\d{8}$/.test(v)) return undefined;
  return `${v.slice(0, 4)}-${v.slice(4, 6)}-${v.slice(6, 8)}`;
}

function handToPlays(h: string | undefined): Plays {
  const s = (h ?? "").toUpperCase();
  if (s === "L") return "left";
  if (s === "R") return "right";
  return "unknown";
}

export interface ParsedPlayers {
  players: TennisPlayer[];
  skipped: number;
}

/** Parse a Sackmann players file (player_id,name_first,name_last,hand,dob,ioc). */
export function parsePlayersCsv(csv: string, tour: TennisTour): ParsedPlayers {
  const { header, data } = rows(csv);
  const idx = (n: string) => header.indexOf(n);
  const iId = idx("player_id"), iFirst = idx("name_first"), iLast = idx("name_last");
  if (iId < 0 || iLast < 0) return { players: [], skipped: data.length };
  const players: TennisPlayer[] = [];
  let skipped = 0;
  for (const r of data) {
    const first = r[iFirst] ?? "";
    const last = r[iLast] ?? "";
    const id = r[iId] ?? "";
    if (!id || !last || [first, last].some(isDangerousCell)) { skipped++; continue; }
    const fullName = `${first} ${last}`.trim();
    players.push({
      id: `csv:${id}`,
      fullName,
      normalizedName: normalizeName(fullName),
      tour,
      countryCode: r[idx("ioc")] || undefined,
      dateOfBirth: isoFromYmd(r[idx("dob")]),
      plays: handToPlays(r[idx("hand")]),
      backhand: "unknown" as Backhand, // Sackmann files do not carry backhand ⇒ unknown, not fabricated
      externalIds: { sackmann: id },
    });
  }
  return { players, skipped };
}

export interface ParsedRankings {
  rankings: RankingSnapshot[];
  skipped: number;
}

/** Parse a Sackmann rankings file (ranking_date,rank,player_id,points). Points
    blank ⇒ undefined (MISSING), never 0. Rankings are point-in-time via asOf. */
export function parseRankingsCsv(csv: string, tour: TennisTour): ParsedRankings {
  const { header, data } = rows(csv);
  const idx = (n: string) => header.indexOf(n);
  const iDate = idx("ranking_date"), iRank = idx("rank"), iPid = idx("player_id"), iPts = idx("points");
  if (iDate < 0 || iRank < 0 || iPid < 0) return { rankings: [], skipped: data.length };
  const rankings: RankingSnapshot[] = [];
  let skipped = 0;
  for (const r of data) {
    const asOf = isoFromYmd(r[iDate]);
    const rank = Number(r[iRank]);
    const pid = r[iPid] ?? "";
    if (!asOf || !pid || !Number.isInteger(rank) || rank <= 0) { skipped++; continue; }
    const ptsRaw = iPts >= 0 ? r[iPts] : "";
    const points = ptsRaw && ptsRaw.trim() !== "" ? Number(ptsRaw) : undefined;
    rankings.push({
      playerId: `csv:${pid}`,
      tour,
      asOf,
      rank,
      points: points !== undefined && Number.isFinite(points) && points >= 0 ? points : undefined,
    });
  }
  return { rankings, skipped };
}
