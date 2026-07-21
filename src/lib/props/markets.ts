/* ============================================================================
   Market navigation registry — the ordered list of player-prop markets shown as
   pills on the /analyze page, mapped to catalog prop keys. Team/game markets
   (NRFI, team totals, moneyline, spread) are intentionally excluded here — the
   /analyze view is player-first; those live on the games pages.
   ========================================================================== */

import { getProp, type PropCategory } from "./catalog";

export interface MarketPill {
  key: string;
  label: string;
  category: PropCategory;
}

/** Ordered markets, following the requested navigation. */
export const MARKET_KEYS: string[] = [
  "strikeouts",       // Pitcher Strikeouts
  "pitcher_outs",     // Pitcher Outs
  "total_bases",
  "hits_runs_rbis",
  "hits_allowed",
  "hits",
  "runs",
  "rbis",
  "home_runs",
  "walks",
  "steals",
  "earned_runs",
  "pitcher_walks",    // Walks Allowed
  "batter_strikeouts",
  "singles",
  "doubles",
  "triples",
  "home_runs_allowed",
  "fantasy_points",
];

export const MARKETS: MarketPill[] = MARKET_KEYS.map((key) => {
  const p = getProp(key)!;
  return { key, label: p.label, category: p.category };
});

/** "Popular" curated subset shown first. */
export const POPULAR_MARKETS = ["strikeouts", "total_bases", "hits", "home_runs", "hits_runs_rbis", "rbis"];

export function marketByKey(key: string): MarketPill | undefined {
  return MARKETS.find((m) => m.key === key);
}
