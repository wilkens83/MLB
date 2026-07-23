/* ============================================================================
   Tennis market catalog — the canonical registry of every tennis market Diamond
   Edge supports, declared through the shared `SportMarket` shape so the sport
   registry and simulation engine treat tennis and MLB uniformly.

   Distribution families are the SHARED ones the engine already understands. Most
   tennis markets are `structural: true` — their probabilities come from the
   point→game→set→match Monte Carlo (Phase 6) summarized via `summarizeSamples`,
   with the declared family used only for charting/fallback. This mirrors how the
   MLB plate-appearance simulator feeds `summarizeSamples`.
   ========================================================================== */

import type { SportMarket } from "@/lib/sports/types";
import type { TennisMarketKey } from "./enums";

export interface TennisMarketDef extends SportMarket {
  key: TennisMarketKey;
  /** True when the market is scored per-player (aces) vs per-match (total games). */
  perPlayer: boolean;
}

export const TENNIS_MARKETS: TennisMarketDef[] = [
  {
    key: "match_winner",
    label: "Match Winner",
    shortLabel: "ML",
    group: "match",
    distFamily: "bernoulli",
    defaultLine: 0.5,
    step: 0.5,
    unit: "win",
    structural: true,
    perPlayer: false,
    description: "Player wins the match outright (moneyline).",
  },
  {
    key: "total_games",
    label: "Total Games",
    shortLabel: "Games O/U",
    group: "match",
    distFamily: "normal",
    defaultLine: 22.5,
    step: 0.5,
    unit: "games",
    structural: true,
    perPlayer: false,
    description: "Total games played in the match by both players.",
  },
  {
    key: "total_sets",
    label: "Total Sets",
    shortLabel: "Sets O/U",
    group: "match",
    distFamily: "bernoulli",
    defaultLine: 2.5,
    step: 1,
    unit: "sets",
    structural: true,
    perPlayer: false,
    description: "Number of sets played (over/under).",
  },
  {
    key: "set_handicap",
    label: "Set Handicap",
    shortLabel: "Set HCP",
    group: "match",
    distFamily: "bernoulli",
    defaultLine: 1.5,
    step: 1,
    unit: "sets",
    structural: true,
    perPlayer: false,
    description: "Player covers a sets handicap (e.g. -1.5 sets).",
  },
  {
    key: "set_winner",
    label: "Set Winner",
    shortLabel: "Set W",
    group: "match",
    distFamily: "bernoulli",
    defaultLine: 0.5,
    step: 0.5,
    unit: "win",
    structural: true,
    perPlayer: false,
    description: "Player wins a specified set.",
  },
  {
    key: "player_games_won",
    label: "Player Games Won",
    shortLabel: "P Games",
    group: "player",
    distFamily: "normal",
    defaultLine: 11.5,
    step: 0.5,
    unit: "games",
    structural: true,
    perPlayer: true,
    description: "Total games won by a single player.",
  },
  {
    key: "aces",
    label: "Aces",
    shortLabel: "Aces",
    group: "player",
    distFamily: "negbinom",
    defaultLine: 6.5,
    step: 0.5,
    unit: "aces",
    structural: true,
    perPlayer: true,
    description: "Aces served by a single player.",
  },
  {
    key: "double_faults",
    label: "Double Faults",
    shortLabel: "DFs",
    group: "player",
    distFamily: "poisson",
    defaultLine: 2.5,
    step: 0.5,
    unit: "DF",
    structural: true,
    perPlayer: true,
    description: "Double faults by a single player.",
  },
  {
    key: "tiebreak_in_match",
    label: "Tiebreak In Match",
    shortLabel: "TB",
    group: "match",
    distFamily: "bernoulli",
    defaultLine: 0.5,
    step: 0.5,
    unit: "yes/no",
    structural: true,
    perPlayer: false,
    description: "At least one tiebreak occurs in the match.",
  },
  {
    key: "exact_score",
    label: "Correct Set Score",
    shortLabel: "Score",
    group: "match",
    distFamily: "bernoulli",
    defaultLine: 0.5,
    step: 0.5,
    unit: "exact",
    structural: true,
    perPlayer: false,
    description: "Exact set score (e.g. 2-0, 2-1).",
  },
];

export const TENNIS_MARKET_BY_KEY: Record<string, TennisMarketDef> = Object.fromEntries(
  TENNIS_MARKETS.map((m) => [m.key, m]),
);

export function getTennisMarket(key: string): TennisMarketDef | undefined {
  return TENNIS_MARKET_BY_KEY[key];
}
