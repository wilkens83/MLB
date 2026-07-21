/* ============================================================================
   Prop series extraction — turn a player's game-log splits into the per-game
   numeric series that a given prop measures. Handles derived stats (singles,
   fantasy points, pitcher outs) that the API does not expose directly.
   ========================================================================== */

import type { GameLogSplit, GameStatLine, StatGroup } from "./types";
import { getProp } from "@/lib/props/catalog";

/** Which stat group a prop's game log must be pulled from. */
export function statGroupForProp(propKey: string): StatGroup {
  const prop = getProp(propKey);
  if (!prop) return "hitting";
  return prop.category === "pitcher" ? "pitching" : "hitting";
}

/** Parse an innings-pitched string ("6.2") into total outs (20). */
export function inningsToOuts(ip?: string): number {
  if (!ip) return 0;
  const [whole, frac = "0"] = ip.split(".");
  return Number(whole) * 3 + Number(frac);
}

/** DraftKings MLB hitter fantasy scoring. */
export function draftKingsHitterPoints(s: GameStatLine): number {
  const singles = single(s);
  return (
    singles * 3 +
    (s.doubles ?? 0) * 5 +
    (s.triples ?? 0) * 8 +
    (s.homeRuns ?? 0) * 10 +
    (s.rbi ?? 0) * 2 +
    (s.runs ?? 0) * 2 +
    (s.baseOnBalls ?? 0) * 2 +
    (s.hitByPitch ?? 0) * 2 +
    (s.stolenBases ?? 0) * 5
  );
}

function single(s: GameStatLine): number {
  return Math.max(0, (s.hits ?? 0) - (s.doubles ?? 0) - (s.triples ?? 0) - (s.homeRuns ?? 0));
}

type Extractor = (s: GameStatLine) => number;

const EXTRACTORS: Record<string, Extractor> = {
  // pitcher
  strikeouts: (s) => s.strikeOuts ?? 0,
  pitcher_outs: (s) => s.outs ?? inningsToOuts(s.inningsPitched),
  earned_runs: (s) => s.earnedRuns ?? 0,
  hits_allowed: (s) => s.hits ?? 0,
  pitcher_walks: (s) => s.baseOnBalls ?? 0,
  home_runs_allowed: (s) => s.homeRuns ?? 0,
  // batter
  hits: (s) => s.hits ?? 0,
  home_runs: (s) => s.homeRuns ?? 0,
  runs: (s) => s.runs ?? 0,
  rbis: (s) => s.rbi ?? 0,
  total_bases: (s) => s.totalBases ?? 0,
  hits_runs_rbis: (s) => (s.hits ?? 0) + (s.runs ?? 0) + (s.rbi ?? 0),
  singles: single,
  doubles: (s) => s.doubles ?? 0,
  triples: (s) => s.triples ?? 0,
  walks: (s) => s.baseOnBalls ?? 0,
  batter_strikeouts: (s) => s.strikeOuts ?? 0,
  steals: (s) => s.stolenBases ?? 0,
  fantasy_points: draftKingsHitterPoints,
};

export interface PropGameSample {
  date?: string;
  opponent?: string;
  isHome?: boolean;
  value: number;
  gamePk?: number;
}

/**
 * Extract the ordered (oldest→newest) per-game samples for a prop from a
 * player's game-log splits, filtering to games actually played.
 */
export function extractPropSeries(propKey: string, splits: GameLogSplit[]): PropGameSample[] {
  const extractor = EXTRACTORS[propKey];
  if (!extractor) return [];
  return splits
    .filter((sp) => (sp.stat.gamesPlayed ?? 1) > 0)
    .map((sp) => ({
      date: sp.date,
      opponent: sp.opponent?.name,
      isHome: sp.isHome,
      value: extractor(sp.stat),
      gamePk: sp.game?.gamePk,
    }));
}

export function seriesValues(samples: PropGameSample[]): number[] {
  return samples.map((s) => s.value);
}
