/* ============================================================================
   Analytics engine — hit-rate, trend and consistency metrics computed from a
   player's per-game series of a single stat, evaluated against a betting line.
   Pure functions over number[] (most-recent-last ordering assumed on input,
   but every window helper handles ordering explicitly).
   ========================================================================== */

import {
  mean,
  median,
  quantile,
  stdDev,
  coefficientOfVariation,
  percentileRank,
  rollingAverage,
  ewma,
} from "@/lib/math/stats";
import { clamp, round } from "@/lib/utils";

export type Side = "over" | "under";

export const STANDARD_WINDOWS = [5, 10, 15, 20, 30] as const;
export type Window = (typeof STANDARD_WINDOWS)[number] | "season";

export interface HitRateResult {
  window: Window;
  games: number;
  /** Fraction of games clearing the line on the requested side (0..1). */
  rate: number;
  /** Count of games that hit. */
  hits: number;
  /** Average of the stat over the window. */
  average: number;
  /** Median of the stat over the window. */
  median: number;
  /** Line used for the evaluation. */
  line: number;
  side: Side;
}

/** Does a single game value clear the line on the given side? Pushes are excluded. */
export function clearsLine(value: number, line: number, side: Side): boolean | null {
  if (value === line) return null; // push — exclude from denominator for .5 lines this never happens
  return side === "over" ? value > line : value < line;
}

/**
 * Hit rate over the most recent `n` games (or whole season). `series` is ordered
 * oldest→newest; we take from the tail.
 */
export function hitRate(
  series: readonly number[],
  line: number,
  side: Side,
  window: Window,
): HitRateResult {
  const n = window === "season" ? series.length : window;
  const slice = series.slice(Math.max(0, series.length - n));
  let hits = 0;
  let counted = 0;
  for (const v of slice) {
    const c = clearsLine(v, line, side);
    if (c === null) continue;
    counted++;
    if (c) hits++;
  }
  return {
    window,
    games: slice.length,
    rate: counted === 0 ? 0 : hits / counted,
    hits,
    average: slice.length ? mean(slice) : 0,
    median: slice.length ? median(slice) : 0,
    line,
    side,
  };
}

/** Compute the hit-rate table across all standard windows plus season. */
export function hitRateTable(
  series: readonly number[],
  line: number,
  side: Side,
): HitRateResult[] {
  const windows: Window[] = [...STANDARD_WINDOWS, "season"];
  return windows.map((w) => hitRate(series, line, side, w));
}

export interface StreakInfo {
  /** Current run length of the same outcome (positive = overs, negative = unders). */
  current: number;
  longestOver: number;
  longestUnder: number;
  /** Outcome sequence, oldest→newest: true = over hit. */
  sequence: boolean[];
}

export function streaks(series: readonly number[], line: number, side: Side = "over"): StreakInfo {
  const seq: boolean[] = [];
  for (const v of series) {
    const c = clearsLine(v, line, side);
    if (c === null) continue;
    seq.push(c);
  }
  let longestOver = 0;
  let longestUnder = 0;
  let runOver = 0;
  let runUnder = 0;
  for (const hit of seq) {
    if (hit) {
      runOver++;
      runUnder = 0;
      longestOver = Math.max(longestOver, runOver);
    } else {
      runUnder++;
      runOver = 0;
      longestUnder = Math.max(longestUnder, runUnder);
    }
  }
  let current = 0;
  for (let i = seq.length - 1; i >= 0; i--) {
    if (i === seq.length - 1) current = seq[i] ? 1 : -1;
    else if (seq[i] === seq[i + 1]) current += seq[i] ? 1 : -1;
    else break;
  }
  return { current, longestOver, longestUnder, sequence: seq };
}

export interface ConsistencyProfile {
  average: number;
  median: number;
  stdDev: number;
  /** Coefficient of variation, 0..1+ (lower = steadier). */
  cv: number;
  /** 0..100 consistency score derived from the CV (higher = more consistent). */
  score: number;
  floor: number; // 10th percentile
  ceiling: number; // 90th percentile
  iqr: number;
}

export function consistency(series: readonly number[]): ConsistencyProfile {
  const avg = mean(series);
  const sd = stdDev(series);
  const cv = coefficientOfVariation(series);
  // Map CV → score with a smooth decay; CV of 0 → 100, CV of 1 → ~37.
  const score = Number.isFinite(cv) ? clamp(round(100 * Math.exp(-cv), 1), 0, 100) : 0;
  return {
    average: avg,
    median: median(series),
    stdDev: sd,
    cv: Number.isFinite(cv) ? cv : 0,
    score,
    floor: quantile(series, 0.1),
    ceiling: quantile(series, 0.9),
    iqr: quantile(series, 0.75) - quantile(series, 0.25),
  };
}

export interface TrendResult {
  /** OLS slope per game — positive means trending up. */
  slope: number;
  /** Recent form (EWMA) vs season average, as a ratio. >1 means hot. */
  formRatio: number;
  rolling5: number[];
  rolling10: number[];
  direction: "up" | "down" | "flat";
}

/** Ordinary least squares slope of value vs game index. */
export function trendSlope(series: readonly number[]): number {
  const n = series.length;
  if (n < 2) return 0;
  const xbar = (n - 1) / 2;
  const ybar = mean(series);
  let num = 0;
  let den = 0;
  for (let i = 0; i < n; i++) {
    num += (i - xbar) * (series[i] - ybar);
    den += (i - xbar) ** 2;
  }
  return den === 0 ? 0 : num / den;
}

export function trend(series: readonly number[]): TrendResult {
  const slope = trendSlope(series);
  const seasonAvg = mean(series);
  const recent = ewma(series, 0.45);
  const formRatio = seasonAvg > 0 ? recent / seasonAvg : 1;
  const relSlope = seasonAvg > 0 ? slope / seasonAvg : slope;
  return {
    slope,
    formRatio: Number.isFinite(formRatio) ? formRatio : 1,
    rolling5: rollingAverage(series, 5),
    rolling10: rollingAverage(series, 10),
    direction: relSlope > 0.015 ? "up" : relSlope < -0.015 ? "down" : "flat",
  };
}

/** Percentile of the current line within the player's distribution. */
export function lineDifficulty(series: readonly number[], line: number): number {
  return round(percentileRank(series, line), 1);
}

/** Convenience bundle used by the player dashboard. */
export interface StatAnalytics {
  series: number[];
  hitRates: HitRateResult[];
  streak: StreakInfo;
  consistency: ConsistencyProfile;
  trend: TrendResult;
  lineDifficulty: number;
}

export function analyzeStat(
  series: readonly number[],
  line: number,
  side: Side = "over",
): StatAnalytics {
  return {
    series: [...series],
    hitRates: hitRateTable(series, line, side),
    streak: streaks(series, line, side),
    consistency: consistency(series),
    trend: trend(series),
    lineDifficulty: lineDifficulty(series, line),
  };
}
