/* ============================================================================
   StatcastProvider — REAL season Statcast metrics from Baseball Savant's public
   custom leaderboard (one request returns every qualified player, cached hard
   and indexed by player_id). Metrics absent from the source stay `undefined`
   and are reported as unavailable; nothing is fabricated.

   Note on windows: Savant does not expose L5/L10/... splits via this endpoint,
   so this provider serves SEASON Statcast baselines. Window-level batted-ball
   metrics would require pitch-level statcast_search aggregation (future work);
   the box-score windows (L5–L30) come from the MLB game-log layer instead.
   ========================================================================== */

import { savantCsv, parseCsv, SAVANT_PROVIDER } from "./savantClient";
import type { StatcastBatter, StatcastPitcher } from "@/lib/domain/models";
import type { StatcastProvider } from "./types";
import { getCurrentMlbSeason } from "@/lib/mlb/season";

const BATTER_SELECTIONS = [
  "player_age", "ab", "pa", "hit", "k_percent", "bb_percent", "batting_avg",
  "slg_percent", "on_base_percent", "woba", "xwoba", "exit_velocity_avg",
  "launch_angle_avg", "sweet_spot_percent", "barrel_batted_rate",
  "hard_hit_percent", "whiff_percent", "swing_percent",
].join(",");

const PITCHER_SELECTIONS = [
  "player_age", "p_formatted_ip", "pa", "k_percent", "bb_percent", "woba",
  "xwoba", "exit_velocity_avg", "barrel_batted_rate", "hard_hit_percent",
  "whiff_percent", "groundballs_percent", "flyballs_percent",
  "linedrives_percent", "fastball_avg_speed",
].join(",");

function leaderboardUrl(type: "batter" | "pitcher", year: number, selections: string) {
  return (
    `/leaderboard/custom?year=${year}&type=${type}&filter=&min=1` +
    `&selections=${selections}&chart=false&x=player_age&y=player_age&r=no&chartType=beeswarm&csv=true`
  );
}

/** Parse a Savant numeric cell; empty/invalid → undefined (never 0-as-missing). */
function num(v: string | undefined): number | undefined {
  if (v === undefined) return undefined;
  const s = v.replace(/"/g, "").trim();
  if (s === "" || s === "null" || s === "NA") return undefined;
  const n = Number(s);
  return Number.isFinite(n) ? n : undefined;
}

interface BatterIndex {
  season: number;
  fetchedAt: number;
  byId: Map<number, StatcastBatter>;
}
interface PitcherIndex {
  season: number;
  fetchedAt: number;
  byId: Map<number, StatcastPitcher>;
}

const batterIndexCache = new Map<number, Promise<BatterIndex>>();
const pitcherIndexCache = new Map<number, Promise<PitcherIndex>>();

function pushMetric(list: string[], key: string, val: number | undefined) {
  if (val !== undefined) list.push(key);
}

async function buildBatterIndex(season: number): Promise<BatterIndex> {
  const csv = await savantCsv(leaderboardUrl("batter", season, BATTER_SELECTIONS));
  const rows = parseCsv(csv);
  const byId = new Map<number, StatcastBatter>();
  const fetchedAt = Date.now();
  for (const r of rows) {
    const id = num(r["player_id"]);
    if (id === undefined) continue;
    const availableMetrics: string[] = [];
    const b: StatcastBatter = {
      playerId: id,
      season,
      pa: num(r["pa"]),
      ab: num(r["ab"]),
      kPct: num(r["k_percent"]),
      bbPct: num(r["bb_percent"]),
      battingAvg: num(r["batting_avg"]),
      slg: num(r["slg_percent"]),
      obp: num(r["on_base_percent"]),
      woba: num(r["woba"]),
      xwoba: num(r["xwoba"]),
      exitVeloAvg: num(r["exit_velocity_avg"]),
      launchAngleAvg: num(r["launch_angle_avg"]),
      sweetSpotPct: num(r["sweet_spot_percent"]),
      barrelPct: num(r["barrel_batted_rate"]),
      hardHitPct: num(r["hard_hit_percent"]),
      whiffPct: num(r["whiff_percent"]),
      swingPct: num(r["swing_percent"]),
      availableMetrics,
      fetchedAt,
    };
    pushMetric(availableMetrics, "xwoba", b.xwoba);
    pushMetric(availableMetrics, "exitVeloAvg", b.exitVeloAvg);
    pushMetric(availableMetrics, "barrelPct", b.barrelPct);
    pushMetric(availableMetrics, "hardHitPct", b.hardHitPct);
    pushMetric(availableMetrics, "whiffPct", b.whiffPct);
    pushMetric(availableMetrics, "kPct", b.kPct);
    pushMetric(availableMetrics, "bbPct", b.bbPct);
    byId.set(id, b);
  }
  return { season, fetchedAt, byId };
}

async function buildPitcherIndex(season: number): Promise<PitcherIndex> {
  const csv = await savantCsv(leaderboardUrl("pitcher", season, PITCHER_SELECTIONS));
  const rows = parseCsv(csv);
  const byId = new Map<number, StatcastPitcher>();
  const fetchedAt = Date.now();
  for (const r of rows) {
    const id = num(r["player_id"]);
    if (id === undefined) continue;
    const availableMetrics: string[] = [];
    const p: StatcastPitcher = {
      playerId: id,
      season,
      ip: num(r["p_formatted_ip"]),
      pa: num(r["pa"]),
      kPct: num(r["k_percent"]),
      bbPct: num(r["bb_percent"]),
      woba: num(r["woba"]),
      xwoba: num(r["xwoba"]),
      exitVeloAvgAllowed: num(r["exit_velocity_avg"]),
      barrelPctAllowed: num(r["barrel_batted_rate"]),
      hardHitPctAllowed: num(r["hard_hit_percent"]),
      whiffPct: num(r["whiff_percent"]),
      gbPct: num(r["groundballs_percent"]),
      fbPct: num(r["flyballs_percent"]),
      ldPct: num(r["linedrives_percent"]),
      fastballVelo: num(r["fastball_avg_speed"]),
      availableMetrics,
      fetchedAt,
    };
    pushMetric(availableMetrics, "kPct", p.kPct);
    pushMetric(availableMetrics, "bbPct", p.bbPct);
    pushMetric(availableMetrics, "xwoba", p.xwoba);
    pushMetric(availableMetrics, "whiffPct", p.whiffPct);
    pushMetric(availableMetrics, "gbPct", p.gbPct);
    pushMetric(availableMetrics, "fastballVelo", p.fastballVelo);
    byId.set(id, p);
  }
  return { season, fetchedAt, byId };
}

/** Reset the in-process Statcast index caches (used by cache admin/tests). */
export function clearStatcastCache() {
  batterIndexCache.clear();
  pitcherIndexCache.clear();
}

/**
 * The full season reference POPULATION of every qualified batter — one Savant
 * leaderboard request, cached. Used to compute real percentile ranks (never a
 * fabricated percentile). Returns [] when the leaderboard is unavailable.
 */
export async function getBatterPopulation(season = getCurrentMlbSeason()): Promise<StatcastBatter[]> {
  try {
    let idxP = batterIndexCache.get(season);
    if (!idxP) { idxP = buildBatterIndex(season); batterIndexCache.set(season, idxP); }
    return [...(await idxP).byId.values()];
  } catch {
    batterIndexCache.delete(season);
    return [];
  }
}

/** The full season reference POPULATION of every qualified pitcher. */
export async function getPitcherPopulation(season = getCurrentMlbSeason()): Promise<StatcastPitcher[]> {
  try {
    let idxP = pitcherIndexCache.get(season);
    if (!idxP) { idxP = buildPitcherIndex(season); pitcherIndexCache.set(season, idxP); }
    return [...(await idxP).byId.values()];
  } catch {
    pitcherIndexCache.delete(season);
    return [];
  }
}

export const savantStatcastProvider: StatcastProvider = {
  name: SAVANT_PROVIDER,

  async getBatter(playerId, season = getCurrentMlbSeason()) {
    try {
      let idxP = batterIndexCache.get(season);
      if (!idxP) {
        idxP = buildBatterIndex(season);
        batterIndexCache.set(season, idxP);
      }
      const idx = await idxP;
      return idx.byId.get(playerId) ?? null;
    } catch {
      batterIndexCache.delete(season);
      return null;
    }
  },

  async getPitcher(playerId, season = getCurrentMlbSeason()) {
    try {
      let idxP = pitcherIndexCache.get(season);
      if (!idxP) {
        idxP = buildPitcherIndex(season);
        pitcherIndexCache.set(season, idxP);
      }
      const idx = await idxP;
      return idx.byId.get(playerId) ?? null;
    } catch {
      pitcherIndexCache.delete(season);
      return null;
    }
  },
};

export { getCurrentMlbSeason as statcastSeason };
