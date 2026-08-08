/* ============================================================================
   Followed-player performance history — pure, deterministic summaries computed
   from a player's per-game prop series. This is the analytics that powers the
   "My Players" performance view (L5 / L10 / L20 / Season windows, trend,
   variance, and PROP HISTORY hit rate against a line).

   TWO HARD RULES, enforced by the shape of this module:

   1. HISTORICAL HIT RATE ≠ MODEL PROBABILITY. The prop-history over/under/push
      rates here are a *descriptive* count of what already happened. They are
      NEVER the model's predicted probability and must be displayed as a
      separate, clearly-labeled quantity. This module has NO access to the
      projection/simulation engine and cannot return a model probability — by
      construction it cannot be mistaken for one.

   2. Trend direction is a rule over past games, NOT a forecast. `direction`
      answers "is recent form above/below the season baseline?" — it is not a
      prediction of the next game and must not be presented as certainty.

   Pure: no I/O, no dates beyond what the caller passes in, no fabrication.
   Missing data yields `available: false`, never a zero-filled fake summary.
   ========================================================================== */

import { mean, median, stdDev, coefficientOfVariation } from "@/lib/math/stats";
import type { PropGameSample } from "@/lib/mlb/series";
import { clearsLine, type Side } from "@/lib/analytics/hitRate";

/** The fixed windows the My Players performance view surfaces. */
export type PerformanceWindowKey = "L5" | "L10" | "L20" | "Season";

const WINDOW_SIZES: Record<Exclude<PerformanceWindowKey, "Season">, number> = {
  L5: 5,
  L10: 10,
  L20: 20,
};

export const PERFORMANCE_WINDOWS: PerformanceWindowKey[] = ["L5", "L10", "L20", "Season"];

/** Descriptive summary of a stat over one window. Purely historical. */
export interface WindowSummary {
  window: PerformanceWindowKey;
  /** Number of games actually in this window (never padded). */
  games: number;
  /** Mean of the stat over the window — null when the window is empty. */
  average: number | null;
  /** Median of the stat over the window — null when the window is empty. */
  median: number | null;
  /** Highest single-game value in the window — null when empty. */
  high: number | null;
  /** Lowest single-game value in the window — null when empty. */
  low: number | null;
}

/** Take the most-recent `n` games from an oldest→newest series. */
function tail<T>(series: readonly T[], n: number): T[] {
  return series.slice(Math.max(0, series.length - n));
}

function summarizeWindow(values: readonly number[], window: PerformanceWindowKey): WindowSummary {
  const n = window === "Season" ? values.length : WINDOW_SIZES[window];
  const slice = tail(values, n);
  if (slice.length === 0) {
    return { window, games: 0, average: null, median: null, high: null, low: null };
  }
  return {
    window,
    games: slice.length,
    average: mean(slice),
    median: median(slice),
    high: Math.max(...slice),
    low: Math.min(...slice),
  };
}

/** Compute the L5 / L10 / L20 / Season summaries for a metric series. */
export function windowSummaries(values: readonly number[]): WindowSummary[] {
  return PERFORMANCE_WINDOWS.map((w) => summarizeWindow(values, w));
}

/**
 * Recent-form trend, expressed as a rule over PAST games — NOT a forecast.
 * `direction` compares the recent-window average to the season baseline. It is
 * intentionally coarse (above / below / around baseline) and carries no
 * probability. Do not present it as a prediction of the next game.
 */
export interface TrendSummary {
  recentAverage: number | null;
  seasonAverage: number | null;
  /** recent / season (null when season avg is 0 or unavailable). */
  ratio: number | null;
  direction: "above-baseline" | "below-baseline" | "around-baseline" | "insufficient-data";
  /** Games used for the recent-form comparison. */
  recentGames: number;
}

export function formTrend(values: readonly number[], recentWindow = 10): TrendSummary {
  if (values.length < 3) {
    return {
      recentAverage: values.length ? mean(values) : null,
      seasonAverage: values.length ? mean(values) : null,
      ratio: null,
      direction: "insufficient-data",
      recentGames: values.length,
    };
  }
  const recent = tail(values, recentWindow);
  const recentAvg = mean(recent);
  const seasonAvg = mean(values);
  const ratio = seasonAvg !== 0 ? recentAvg / seasonAvg : null;
  let direction: TrendSummary["direction"] = "around-baseline";
  if (ratio !== null) {
    if (ratio > 1.08) direction = "above-baseline";
    else if (ratio < 0.92) direction = "below-baseline";
  }
  return {
    recentAverage: recentAvg,
    seasonAverage: seasonAvg,
    ratio,
    direction,
    recentGames: recent.length,
  };
}

/** Dispersion / stability of the series — descriptive, never predictive. */
export interface VariabilitySummary {
  stdDev: number | null;
  /** Coefficient of variation — lower is steadier (null when mean is 0). */
  cv: number | null;
  range: [number, number] | null;
  sampleSize: number;
}

export function variability(values: readonly number[]): VariabilitySummary {
  if (values.length === 0) {
    return { stdDev: null, cv: null, range: null, sampleSize: 0 };
  }
  const cv = coefficientOfVariation(values);
  return {
    stdDev: values.length >= 2 ? stdDev(values) : 0,
    cv: Number.isFinite(cv) ? cv : null,
    range: [Math.min(...values), Math.max(...values)],
    sampleSize: values.length,
  };
}

/**
 * PROP HISTORY against a line — a purely HISTORICAL count of how often the
 * player cleared a given line, split by window. `overRate`/`underRate` are the
 * fraction of *decided* games (pushes excluded from the denominator) that went
 * over / under. These are NOT model probabilities.
 */
export interface PropHistoryWindow {
  window: PerformanceWindowKey;
  games: number;
  /** Games strictly over the line. */
  over: number;
  /** Games strictly under the line. */
  under: number;
  /** Games exactly on the line (integer lines only). */
  push: number;
  /** over / (over + under) — null when no decided games. NOT a prediction. */
  overRate: number | null;
  /** under / (over + under) — null when no decided games. NOT a prediction. */
  underRate: number | null;
}

function propHistoryWindow(
  values: readonly number[],
  line: number,
  window: PerformanceWindowKey,
): PropHistoryWindow {
  const n = window === "Season" ? values.length : WINDOW_SIZES[window];
  const slice = tail(values, n);
  let over = 0;
  let under = 0;
  let push = 0;
  for (const v of slice) {
    const c = clearsLine(v, line, "over" satisfies Side);
    if (c === null) push++;
    else if (c) over++;
    else under++;
  }
  const decided = over + under;
  return {
    window,
    games: slice.length,
    over,
    under,
    push,
    overRate: decided === 0 ? null : over / decided,
    underRate: decided === 0 ? null : under / decided,
  };
}

export function propHistory(values: readonly number[], line: number): PropHistoryWindow[] {
  return PERFORMANCE_WINDOWS.map((w) => propHistoryWindow(values, line, w));
}

/** The full performance record for one player+metric. */
export interface PlayerMetricPerformance {
  playerId: number; // canonical MLBAM id
  metric: string; // prop key (display label resolved in UI)
  available: boolean;
  sampleSize: number;
  windows: WindowSummary[];
  trend: TrendSummary;
  variability: VariabilitySummary;
  /** Present only when a line was supplied. Historical, never a model prob. */
  propHistory?: PropHistoryWindow[];
  /** Most recent game (newest), for the "last game" line on the card. */
  lastGame?: PropGameSample;
  /** ISO timestamp the caller computed this at (provenance). */
  computedAt?: string;
}

/**
 * Build the full performance record for a player+metric from an oldest→newest
 * prop series. When `line` is supplied, prop-history hit rates are included —
 * always as HISTORICAL counts, never as model probabilities.
 */
export function buildMetricPerformance(
  playerId: number,
  metric: string,
  samples: readonly PropGameSample[],
  opts: { line?: number; computedAt?: string } = {},
): PlayerMetricPerformance {
  const values = samples.map((s) => s.value);
  const available = values.length > 0;
  return {
    playerId,
    metric,
    available,
    sampleSize: values.length,
    windows: windowSummaries(values),
    trend: formTrend(values),
    variability: variability(values),
    propHistory: opts.line !== undefined ? propHistory(values, opts.line) : undefined,
    lastGame: samples.length ? samples[samples.length - 1] : undefined,
    computedAt: opts.computedAt,
  };
}
