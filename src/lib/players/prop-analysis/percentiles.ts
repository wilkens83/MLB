/* ============================================================================
   Percentile matchup — REAL percentile ranks computed against the season Statcast
   reference POPULATION (every qualified player). Nothing is invented: a metric
   with no value, or an empty population, yields a null percentile (N/A).

   Each row compares the analyzed player to the opponent on a compatible axis and
   derives an advantage direction from SKILL-adjusted percentiles (e.g. a high
   batter K% and a high pitcher K% both favor the pitcher). The edge is a
   principled function of the two real percentiles — never a hand-set value.
   ========================================================================== */

import { percentileRank } from "@/lib/math/stats";
import type { StatcastBatter, StatcastPitcher } from "@/lib/domain/models";
import type { VmPercentileRow } from "./types";

type BatterKey = keyof StatcastBatter;
type PitcherKey = keyof StatcastPitcher;

/** One comparable matchup axis and which direction favors each side. */
interface MetricSpec {
  label: string;
  batterKey: BatterKey;
  pitcherKey: PitcherKey;
  /** true when a higher value is better FOR THE BATTER. */
  batterHigherBetter: boolean;
  /** true when a higher value is better FOR THE PITCHER. */
  pitcherHigherBetter: boolean;
}

/** Compatible batter↔pitcher axes (three-true-outcome + contact quality). */
const SPECS: MetricSpec[] = [
  { label: "K%", batterKey: "kPct", pitcherKey: "kPct", batterHigherBetter: false, pitcherHigherBetter: true },
  { label: "BB%", batterKey: "bbPct", pitcherKey: "bbPct", batterHigherBetter: true, pitcherHigherBetter: false },
  { label: "Whiff%", batterKey: "whiffPct", pitcherKey: "whiffPct", batterHigherBetter: false, pitcherHigherBetter: true },
  { label: "xwOBA", batterKey: "xwoba", pitcherKey: "xwoba", batterHigherBetter: true, pitcherHigherBetter: false },
  { label: "HardHit%", batterKey: "hardHitPct", pitcherKey: "hardHitPctAllowed", batterHigherBetter: true, pitcherHigherBetter: false },
  { label: "Barrel%", batterKey: "barrelPct", pitcherKey: "barrelPctAllowed", batterHigherBetter: true, pitcherHigherBetter: false },
];

function numAt<T>(obj: T | null | undefined, key: keyof T): number | null {
  if (!obj) return null;
  const v = obj[key] as unknown;
  return typeof v === "number" && Number.isFinite(v) ? v : null;
}

function column(pop: readonly Record<string, unknown>[], key: string): number[] {
  const out: number[] = [];
  for (const p of pop) {
    const v = p[key];
    if (typeof v === "number" && Number.isFinite(v)) out.push(v);
  }
  return out;
}

function pctRank(pop: number[], value: number | null): number | null {
  if (value === null || pop.length < 20) return null; // need a real population
  const r = percentileRank(pop, value);
  return Number.isFinite(r) ? Math.round(r) : null;
}

export interface PercentileMatchupResult {
  rows: VmPercentileRow[];
  referenceSize: number | null;
}

/**
 * Build the percentile matchup for a hitter prop: the analyzed BATTER (left) vs
 * the opposing PITCHER (right). Percentiles come from the batter/pitcher
 * populations respectively; the edge is from skill-adjusted percentiles.
 * `perspective` says which side is the analyzed player (for edge sign).
 */
export function buildPercentileRows(
  batter: StatcastBatter | null,
  pitcher: StatcastPitcher | null,
  batterPop: readonly StatcastBatter[],
  pitcherPop: readonly StatcastPitcher[],
  perspective: "batter" | "pitcher",
): PercentileMatchupResult {
  const refSize = Math.min(batterPop.length, pitcherPop.length);
  const rows: VmPercentileRow[] = [];
  for (const spec of SPECS) {
    const bVal = numAt(batter, spec.batterKey);
    const pVal = numAt(pitcher, spec.pitcherKey);
    if (bVal === null && pVal === null) continue;
    const bPct = pctRank(column(batterPop as unknown as Record<string, unknown>[], spec.batterKey as string), bVal);
    const pPct = pctRank(column(pitcherPop as unknown as Record<string, unknown>[], spec.pitcherKey as string), pVal);

    // skill-adjusted percentile (higher = better for that side)
    const bSkill = bPct === null ? null : spec.batterHigherBetter ? bPct : 100 - bPct;
    const pSkill = pPct === null ? null : spec.pitcherHigherBetter ? pPct : 100 - pPct;

    let edge: VmPercentileRow["edge"] = null;
    if (bSkill !== null && pSkill !== null) {
      // positive delta favors the pitcher (pitcher more skilled on this axis)
      const delta = pSkill - bSkill;
      edge = delta > 15 ? "pitcher" : delta < -15 ? "batter" : "neutral";
    }

    // player value/percentile is the analyzed side; opponent is the other
    const playerIsBatter = perspective === "batter";
    rows.push({
      metric: spec.label,
      label: spec.label,
      playerValue: playerIsBatter ? bVal : pVal,
      playerPercentile: playerIsBatter ? bPct : pPct,
      opponentValue: playerIsBatter ? pVal : bVal,
      opponentPercentile: playerIsBatter ? pPct : bPct,
      edge,
    });
  }
  return { rows, referenceSize: refSize >= 20 ? refSize : null };
}

/**
 * Aggregate a set of batters into a single "lineup profile" (PA-weighted mean
 * per metric) so a pitcher can be compared against the opposing lineup. Missing
 * per-batter values are skipped, never treated as zero.
 */
export function aggregateLineupProfile(batters: readonly StatcastBatter[]): StatcastBatter | null {
  if (batters.length === 0) return null;
  const keys: BatterKey[] = ["kPct", "bbPct", "whiffPct", "xwoba", "hardHitPct", "barrelPct", "battingAvg", "slg"];
  const out: Partial<StatcastBatter> = { playerId: -1, season: batters[0].season, availableMetrics: [], fetchedAt: Date.now() };
  for (const key of keys) {
    let wsum = 0;
    let vsum = 0;
    for (const b of batters) {
      const v = numAt(b, key);
      if (v === null) continue;
      const w = numAt(b, "pa") ?? 1;
      wsum += w;
      vsum += v * w;
    }
    if (wsum > 0) {
      (out as Record<string, number>)[key as string] = vsum / wsum;
      (out.availableMetrics as string[]).push(key as string);
    }
  }
  return out as StatcastBatter;
}
