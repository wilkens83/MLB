/* ============================================================================
   Result grading (Phase 23). Grades an imported line against the REAL final
   box-score outcome. Uses raw integer stats (never rounded/display values) and
   reuses the same derived-stat formulas as the projection engine so grading and
   modeling stay consistent.
   ========================================================================== */

import { draftKingsHitterPoints, inningsToOuts } from "@/lib/mlb/series";
import type { GameStatLine } from "@/lib/mlb/types";
import type { ResultGrade } from "./types";

/** Grade a raw actual value against a line. */
export function gradeResult(line: number, actual: number): ResultGrade {
  if (!Number.isFinite(actual)) return "void";
  if (actual > line) return "more";
  if (actual < line) return "less";
  return "push";
}

/** Which stat group a market's final result is read from. */
export function statGroupForMarket(marketKey: string): "hitting" | "pitching" {
  return PITCHER_MARKETS.has(marketKey) ? "pitching" : "hitting";
}

const PITCHER_MARKETS = new Set([
  "strikeouts", "pitcher_outs", "earned_runs", "hits_allowed", "pitcher_walks", "home_runs_allowed",
]);

/**
 * Compute the real actual value for a market from a final box-score stat line.
 * Returns null for markets the engine cannot grade from a single box score.
 */
export function computeActual(marketKey: string, s: GameStatLine): number | null {
  const single = Math.max(0, (s.hits ?? 0) - (s.doubles ?? 0) - (s.triples ?? 0) - (s.homeRuns ?? 0));
  switch (marketKey) {
    // pitcher
    case "strikeouts": return s.strikeOuts ?? 0;
    case "pitcher_outs": return s.outs ?? inningsToOuts(s.inningsPitched);
    case "earned_runs": return s.earnedRuns ?? 0;
    case "hits_allowed": return s.hits ?? 0;
    case "pitcher_walks": return s.baseOnBalls ?? 0;
    case "home_runs_allowed": return s.homeRuns ?? 0;
    // hitter
    case "hits": return s.hits ?? 0;
    case "singles": return single;
    case "doubles": return s.doubles ?? 0;
    case "triples": return s.triples ?? 0;
    case "home_runs": return s.homeRuns ?? 0;
    case "total_bases": return s.totalBases ?? single + 2 * (s.doubles ?? 0) + 3 * (s.triples ?? 0) + 4 * (s.homeRuns ?? 0);
    case "runs": return s.runs ?? 0;
    case "rbis": return s.rbi ?? 0;
    case "hits_runs_rbis": return (s.hits ?? 0) + (s.runs ?? 0) + (s.rbi ?? 0);
    case "walks": return s.baseOnBalls ?? 0;
    case "batter_strikeouts": return s.strikeOuts ?? 0;
    case "steals": return s.stolenBases ?? 0;
    case "fantasy_points": return Math.round(draftKingsHitterPoints(s) * 10) / 10;
    // not gradable from a single box score in the current engine
    case "first_inning_runs":
    case "pitcher_fantasy_score":
    default:
      return null;
  }
}
