/* ============================================================================
   Pitch-arsenal provider — real per-pitch-type results from Baseball Savant's
   public pitch-arsenal-stats leaderboard (usage, whiff%, put-away%, and BA/SLG/
   xwOBA allowed by pitch). One request returns every pitcher; indexed by id and
   cached hard. Velocity/spin/break are a separate movement endpoint (not yet
   wired) and are surfaced as N/A rather than fabricated.
   ========================================================================== */

import { savantCsv, parseCsv } from "./savantClient";

const CURRENT_SEASON = 2026;

export interface PitchType {
  pitchType: string;
  pitchName: string;
  usage?: number; // %
  pitches?: number;
  whiffPct?: number;
  kPct?: number;
  putAwayPct?: number;
  baAllowed?: number;
  slgAllowed?: number;
  xwobaAllowed?: number;
  hardHitPct?: number;
}

export interface PitcherArsenal {
  playerId: number;
  season: number;
  pitches: PitchType[];
  fetchedAt: number;
}

function num(v: string | undefined): number | undefined {
  if (v === undefined) return undefined;
  const s = v.replace(/"/g, "").trim();
  if (s === "" || s === "null") return undefined;
  const n = Number(s);
  return Number.isFinite(n) ? n : undefined;
}

const cache = new Map<number, Promise<Map<number, PitcherArsenal>>>();

async function buildIndex(season: number): Promise<Map<number, PitcherArsenal>> {
  const csv = await savantCsv(
    `/leaderboard/pitch-arsenal-stats?type=pitcher&pitchType=&year=${season}&team=&min=1&csv=true`,
  );
  const rows = parseCsv(csv);
  const byId = new Map<number, PitcherArsenal>();
  const fetchedAt = Date.now();
  for (const r of rows) {
    const id = num(r["player_id"]);
    if (id === undefined) continue;
    const pitch: PitchType = {
      pitchType: r["pitch_type"] ?? "",
      pitchName: r["pitch_name"] ?? "",
      usage: num(r["pitch_usage"]),
      pitches: num(r["pitches"]),
      whiffPct: num(r["whiff_percent"]),
      kPct: num(r["k_percent"]),
      putAwayPct: num(r["put_away"]),
      baAllowed: num(r["ba"]),
      slgAllowed: num(r["slg"]),
      xwobaAllowed: num(r["est_woba"]),
      hardHitPct: num(r["hard_hit_percent"]),
    };
    const existing = byId.get(id);
    if (existing) existing.pitches.push(pitch);
    else byId.set(id, { playerId: id, season, pitches: [pitch], fetchedAt });
  }
  // Sort each pitcher's pitches by usage descending.
  for (const a of byId.values()) a.pitches.sort((x, y) => (y.usage ?? 0) - (x.usage ?? 0));
  return byId;
}

export async function getPitcherArsenal(
  playerId: number,
  season = CURRENT_SEASON,
): Promise<PitcherArsenal | null> {
  try {
    let idx = cache.get(season);
    if (!idx) {
      idx = buildIndex(season);
      cache.set(season, idx);
    }
    return (await idx).get(playerId) ?? null;
  } catch {
    cache.delete(season);
    return null;
  }
}

export function clearArsenalCache() {
  cache.clear();
}
