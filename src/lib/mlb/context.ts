/* ============================================================================
   Contextual factors — ballpark run/HR environments and helpers to translate
   game context into the multiplicative adjustments the projection engine uses.
   Park factors are expressed as ~1.0 = neutral (100 index / 100).
   ========================================================================== */

import type { ContextAdjustments } from "@/lib/prediction/projection";

export interface ParkFactor {
  runs: number;
  hr: number;
  hits: number;
}

/** Approximate multi-year park factors (index/100) keyed by venue name. */
export const PARK_FACTORS: Record<string, ParkFactor> = {
  "Coors Field": { runs: 1.33, hr: 1.14, hits: 1.19 },
  "Fenway Park": { runs: 1.1, hr: 1.02, hits: 1.09 },
  "Great American Ball Park": { runs: 1.09, hr: 1.27, hits: 1.03 },
  "Yankee Stadium": { runs: 1.03, hr: 1.19, hits: 0.99 },
  "Globe Life Field": { runs: 1.02, hr: 1.05, hits: 1.02 },
  "Chase Field": { runs: 1.04, hr: 1.06, hits: 1.03 },
  "Wrigley Field": { runs: 1.02, hr: 1.04, hits: 1.01 },
  "Citizens Bank Park": { runs: 1.02, hr: 1.12, hits: 1.0 },
  "Truist Park": { runs: 1.0, hr: 1.03, hits: 1.0 },
  "Dodger Stadium": { runs: 0.98, hr: 1.1, hits: 0.96 },
  "Oracle Park": { runs: 0.9, hr: 0.79, hits: 0.95 },
  "Petco Park": { runs: 0.94, hr: 0.94, hits: 0.95 },
  "T-Mobile Park": { runs: 0.92, hr: 0.95, hits: 0.93 },
  "loanDepot park": { runs: 0.9, hr: 0.86, hits: 0.94 },
  "Comerica Park": { runs: 0.96, hr: 0.9, hits: 0.98 },
  "Kauffman Stadium": { runs: 1.0, hr: 0.91, hits: 1.03 },
  "Busch Stadium": { runs: 0.97, hr: 0.92, hits: 0.99 },
  "American Family Field": { runs: 1.01, hr: 1.08, hits: 0.99 },
  "Nationals Park": { runs: 1.0, hr: 1.02, hits: 1.0 },
  "Citi Field": { runs: 0.96, hr: 0.97, hits: 0.97 },
  "Target Field": { runs: 1.0, hr: 1.01, hits: 1.0 },
  "Progressive Field": { runs: 0.98, hr: 0.98, hits: 0.98 },
  "Angel Stadium": { runs: 1.0, hr: 1.03, hits: 1.0 },
  "Minute Maid Park": { runs: 1.01, hr: 1.05, hits: 1.0 },
  "PNC Park": { runs: 0.97, hr: 0.9, hits: 0.99 },
  "Rogers Centre": { runs: 1.02, hr: 1.07, hits: 1.0 },
  "Oriole Park at Camden Yards": { runs: 1.0, hr: 1.0, hits: 1.0 },
  "Guaranteed Rate Field": { runs: 1.01, hr: 1.09, hits: 0.99 },
  "Sutter Health Park": { runs: 1.03, hr: 1.06, hits: 1.02 },
  "George M. Steinbrenner Field": { runs: 1.05, hr: 1.12, hits: 1.02 },
};

export function parkFactor(venueName?: string): ParkFactor {
  if (!venueName) return { runs: 1, hr: 1, hits: 1 };
  return PARK_FACTORS[venueName] ?? { runs: 1, hr: 1, hits: 1 };
}

/** Pick the park multiplier relevant to a given prop family. */
export function parkMultiplierForProp(propKey: string, venueName?: string): number {
  const pf = parkFactor(venueName);
  if (propKey === "home_runs") return pf.hr;
  if (["hits", "singles", "doubles", "triples", "hits_allowed", "team_hits"].includes(propKey))
    return pf.hits;
  if (
    ["runs", "rbis", "total_bases", "earned_runs", "team_total", "total_runs", "first_inning_runs"].includes(
      propKey,
    )
  )
    return pf.runs;
  return 1;
}

/**
 * Temperature effect on offense — warmer air is less dense, so batted balls
 * carry further. Roughly +1% offense per ~5°F above 70°F, capped.
 */
export function weatherMultiplier(propKey: string, tempF?: number): number {
  if (tempF === undefined) return 1;
  const isOffense = [
    "home_runs",
    "hits",
    "runs",
    "rbis",
    "total_bases",
    "team_total",
    "total_runs",
  ].includes(propKey);
  if (!isOffense) return 1;
  const delta = (tempF - 70) / 5;
  return Math.max(0.94, Math.min(1.08, 1 + delta * 0.01));
}

export interface BuildContextArgs {
  propKey: string;
  venueName?: string;
  tempF?: number;
  /** 1 = neutral. Provide opponent/handedness multipliers if available. */
  opponent?: number;
  handedness?: number;
  rest?: number;
  usage?: number;
}

export function buildContext(args: BuildContextArgs): ContextAdjustments {
  return {
    park: parkMultiplierForProp(args.propKey, args.venueName),
    weather: weatherMultiplier(args.propKey, args.tempF),
    opponent: args.opponent,
    handedness: args.handedness,
    rest: args.rest,
    usage: args.usage,
  };
}
