/* ============================================================================
   Market analysis configuration — declares, per prop market, how the research
   page should render it: the charted stat, the metrics that matter for the
   player and the matchup, the contextual "suggested filters", and the allowed
   history windows. This REUSES the canonical prop catalog (`getProp`) for the
   stat mapping and never invents an unsupported market.

   The config is intentionally declarative and pure so the same reusable page
   works for every pitcher/hitter market with one entry here.
   ========================================================================== */

import { getProp, propsByCategory, type PropDef } from "@/lib/props/catalog";

export type MetricKey = string;

export interface MarketAnalysisConfig {
  marketKey: string;
  label: string;
  shortLabel: string;
  playerType: "pitcher" | "batter";
  /** The per-game stat charted in the recent-performance chart (the prop itself). */
  chartStat: string;
  unit: string;
  defaultLine: number;
  step: number;
  /** Header metrics surfaced beside the player (season profile). */
  relevantMetrics: MetricKey[];
  /** Metrics used for the player-vs-opponent percentile matchup. */
  matchupMetrics: MetricKey[];
  /** Contextual filters suggested for THIS market (must be derivable from data). */
  suggestedFilters: string[];
  /** History windows the chart/hit-rate table may use. */
  allowedWindows: number[];
}

const DEFAULT_WINDOWS = [5, 10, 20, 30];

/** Pitcher-market suggested filters and matchup axes (all Statcast-derivable). */
const PITCHER_MATCHUP = ["kPct", "bbPct", "whiffPct", "xwoba", "hardHitPctAllowed", "barrelPctAllowed"];
const PITCHER_SUGGESTED = ["Innings Pitched", "Opponent K%", "Opponent Whiff%", "Opponent BB%", "Opponent Chase%", "Opponent Contact%"];

const HITTER_MATCHUP = ["battingAvg", "bbPct", "kPct", "whiffPct", "xwoba", "barrelPct", "hardHitPct"];
const HITTER_SUGGESTED = ["Expected PA", "xBA", "Contact%", "Opponent Hits Allowed", "Pitcher handedness"];
const HR_SUGGESTED = ["Barrel%", "HardHit%", "Fly Ball%", "Pull%", "Pitcher HR%", "Park HR factor", "Weather"];

/** Per-market overrides layered onto the catalog defaults. */
const OVERRIDES: Record<string, Partial<MarketAnalysisConfig>> = {
  // pitcher
  strikeouts: { relevantMetrics: ["kPct", "bbPct", "whiffPct", "era", "xera"], matchupMetrics: PITCHER_MATCHUP, suggestedFilters: PITCHER_SUGGESTED },
  pitcher_outs: { relevantMetrics: ["ip", "kPct", "era"], matchupMetrics: PITCHER_MATCHUP, suggestedFilters: ["Innings Pitched", "Pitch Count", "Opponent Contact%"] },
  earned_runs: { relevantMetrics: ["era", "xera", "hardHitPctAllowed", "barrelPctAllowed"], matchupMetrics: PITCHER_MATCHUP, suggestedFilters: ["Opponent wOBA", "HardHit% allowed", "Park Runs factor"] },
  hits_allowed: { relevantMetrics: ["hardHitPctAllowed", "xwoba", "kPct"], matchupMetrics: PITCHER_MATCHUP, suggestedFilters: ["Opponent BA", "HardHit% allowed", "Contact%"] },
  pitcher_walks: { relevantMetrics: ["bbPct", "whiffPct"], matchupMetrics: PITCHER_MATCHUP, suggestedFilters: ["Opponent BB%", "Opponent Chase%", "Zone%"] },
  home_runs_allowed: { relevantMetrics: ["barrelPctAllowed", "hardHitPctAllowed", "fbPct"], matchupMetrics: PITCHER_MATCHUP, suggestedFilters: ["Barrel% allowed", "Park HR factor", "Fly Ball%"] },
  // batter
  hits: { relevantMetrics: ["battingAvg", "kPct", "whiffPct", "xwoba"], matchupMetrics: HITTER_MATCHUP, suggestedFilters: HITTER_SUGGESTED },
  home_runs: { relevantMetrics: ["barrelPct", "hardHitPct", "slg", "xwoba"], matchupMetrics: HITTER_MATCHUP, suggestedFilters: HR_SUGGESTED },
  total_bases: { relevantMetrics: ["slg", "barrelPct", "hardHitPct", "xwoba"], matchupMetrics: HITTER_MATCHUP, suggestedFilters: ["xSLG", "Barrel%", "HardHit%", "Park factor"] },
  hits_runs_rbis: { relevantMetrics: ["battingAvg", "slg", "xwoba"], matchupMetrics: HITTER_MATCHUP, suggestedFilters: ["Expected PA", "Lineup slot", "Opponent wOBA"] },
  runs: { relevantMetrics: ["obp", "battingAvg"], matchupMetrics: HITTER_MATCHUP, suggestedFilters: ["Lineup slot", "Team total", "OBP"] },
  rbis: { relevantMetrics: ["slg", "barrelPct"], matchupMetrics: HITTER_MATCHUP, suggestedFilters: ["Lineup slot", "Team total", "SLG"] },
  walks: { relevantMetrics: ["bbPct", "obp"], matchupMetrics: HITTER_MATCHUP, suggestedFilters: ["BB%", "Opponent Zone%", "Pitcher BB%"] },
  batter_strikeouts: { relevantMetrics: ["kPct", "whiffPct", "swingPct"], matchupMetrics: HITTER_MATCHUP, suggestedFilters: ["K%", "Whiff%", "Pitcher K%"] },
  singles: { relevantMetrics: ["battingAvg", "sweetSpotPct"], matchupMetrics: HITTER_MATCHUP, suggestedFilters: ["BA", "Contact%", "BABIP"] },
  doubles: { relevantMetrics: ["slg", "hardHitPct"], matchupMetrics: HITTER_MATCHUP, suggestedFilters: ["HardHit%", "Park 2B factor"] },
  fantasy_points: { relevantMetrics: ["woba", "slg", "obp"], matchupMetrics: HITTER_MATCHUP, suggestedFilters: ["Expected PA", "wOBA", "Lineup slot"] },
};

function baseConfig(prop: PropDef): MarketAnalysisConfig {
  const playerType = prop.category === "pitcher" ? "pitcher" : "batter";
  return {
    marketKey: prop.key,
    label: prop.label,
    shortLabel: prop.shortLabel,
    playerType,
    chartStat: prop.key,
    unit: prop.unit,
    defaultLine: prop.defaultLine,
    step: prop.step,
    relevantMetrics: [],
    matchupMetrics: playerType === "pitcher" ? PITCHER_MATCHUP : HITTER_MATCHUP,
    suggestedFilters: playerType === "pitcher" ? PITCHER_SUGGESTED : HITTER_SUGGESTED,
    allowedWindows: DEFAULT_WINDOWS,
  };
}

/** Resolve the analysis config for a market, or undefined for an unsupported one. */
export function getMarketConfig(marketKey: string): MarketAnalysisConfig | undefined {
  const prop = getProp(marketKey);
  if (!prop || (prop.category !== "pitcher" && prop.category !== "batter")) return undefined;
  return { ...baseConfig(prop), ...OVERRIDES[marketKey] };
}

/** Ordered analysis markets for a player type (pitcher vs batter), catalog-driven. */
export function marketsForPlayerType(isPitcher: boolean): MarketAnalysisConfig[] {
  return propsByCategory(isPitcher ? "pitcher" : "batter").map((p) => ({ ...baseConfig(p), ...OVERRIDES[p.key] }));
}

/** The default market to open for a player type. */
export function defaultMarketFor(isPitcher: boolean): string {
  return isPitcher ? "strikeouts" : "hits";
}
