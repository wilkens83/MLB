/* ============================================================================
   Independent market baselines. The model must beat an INDEPENDENT reference —
   never itself. Each baseline is a league-prior distribution for the market
   (not the player's projection), evaluated against the imported line. This gives
   `baselineProbability` for the selected side, so:

       modelAdvantage = calibratedProbability − baselineProbability

   is a genuine edge over a naive market-average bettor. Priority markets only
   (pitcher strikeouts, pitcher outs, hitter hits, total bases) — the mission does
   NOT expand to every market.

   Pure: reuses the Poisson CDF from the math core; no model/projection input.
   ========================================================================== */

import { poissonCdf } from "@/lib/math/stats";

/** League-average per-game rate priors (independent of any specific player). */
const LEAGUE_PRIOR_MEAN: Record<string, number> = {
  strikeouts: 5.4, // pitcher K per start
  pitcher_outs: 17.0, // ~5.2 IP
  hits: 0.9, // hitter hits per game
  total_bases: 1.45, // hitter total bases per game
};

export const BASELINE_MARKETS = Object.keys(LEAGUE_PRIOR_MEAN);

export interface IndependentBaseline {
  available: boolean;
  market: string;
  priorMean?: number;
  probabilityMore?: number;
  probabilityLess?: number;
  reason?: string;
}

/**
 * League-prior baseline for a market/line. Uses a Poisson with the market's
 * league-average mean — deliberately NOT the player's model. Returns
 * `available:false` for any market outside the priority set (never guessed).
 */
export function independentBaseline(market: string, line: number): IndependentBaseline {
  const mean = LEAGUE_PRIOR_MEAN[market];
  if (mean === undefined) {
    return { available: false, market, reason: `no independent baseline for market "${market}"` };
  }
  if (!Number.isFinite(line) || line < 0) {
    return { available: false, market, priorMean: mean, reason: "invalid line" };
  }
  // For a half-line L, P(value > L) = P(value >= ceil(L)) = 1 − CDF(floor(L)).
  const k = Math.floor(line);
  const pLess = poissonCdf(k, mean); // P(value <= floor(line))
  const pMore = 1 - pLess;
  return {
    available: true,
    market,
    priorMean: mean,
    probabilityMore: clampUnit(pMore),
    probabilityLess: clampUnit(pLess),
  };
}

/** The baseline probability for a chosen side (independent reference). */
export function baselineForSide(baseline: IndependentBaseline, side: "more" | "less"): number | undefined {
  if (!baseline.available) return undefined;
  return side === "more" ? baseline.probabilityMore : baseline.probabilityLess;
}

const clampUnit = (n: number) => Math.min(1, Math.max(0, n));
