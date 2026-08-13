/* ============================================================================
   Pitcher usage / exposure / joint-simulation domain types.

   The scientific ordering these types encode: a starter's OPPORTUNITY (pitches /
   batters faced / outs) is projected first; a removal hazard then shortens the
   outing endogenously based on in-game performance; per-BF event RATES convert
   that exposure into the six correlated pitcher props. A market line is applied
   only AFTER the joint distribution exists — it never changes the projection.
   ========================================================================== */

import type { PaRates } from "@/lib/prediction/paSim";

export const PITCHER_SIM_VERSION = "pitcher-joint-1.0.0";

/** Canonical pitcher counting props that share one simulated start. */
export const PITCHER_JOINT_PROPS = [
  "strikeouts",
  "pitcher_outs",
  "earned_runs",
  "hits_allowed",
  "pitcher_walks",
  "home_runs_allowed",
] as const;
export type PitcherJointProp = (typeof PITCHER_JOINT_PROPS)[number];

/** A light distribution summary reused across usage + prop outputs. */
export interface DistSummary {
  mean: number;
  median: number;
  stdDev: number;
  /** 80% central interval [p10, p90]. */
  p10: number;
  p90: number;
}

export type ProvenanceSource = "gamelog" | "statcast" | "prior" | "blend";

/** Which inputs actually drove a value (for honest observability). */
export interface UsageProvenance {
  version: string;
  startsUsed: number;
  hadPitchCounts: boolean;
  hadBattersFaced: boolean;
  sources: Record<string, ProvenanceSource>;
  warnings: string[];
  generatedAt: number;
}

/** Removal/hook hazard configuration + the resulting per-start risk summary. */
export interface RemovalRisk {
  /** Simulated probability the start ends before recording a full 6 innings. */
  pBefore6IP: number;
  /** Average pitch count at removal across simulated starts. */
  meanHookPitchCount: number;
  /** Fraction of removals driven primarily by pitch-count vs performance. */
  hookReason: { pitchCount: number; performance: number; capped: number };
}

export interface PitcherUsageProjection {
  expectedPitches: number;
  expectedBattersFaced: number;
  expectedOuts: number;
  expectedInnings: number;

  pitches: DistSummary;
  battersFaced: DistSummary;
  outs: DistSummary;

  /** P(outs ≥ k) for common thresholds, straight from the simulated outs dist. */
  outsExceedance: { p15: number; p18: number; p21: number };
  /** P(≥ N innings) convenience view (5/6/7 IP). */
  inningsExceedance: { ip5: number; ip6: number; ip7: number };

  removalRisk: RemovalRisk;
  provenance: UsageProvenance;
}

/** A single simulated start — the JOINT outcome all six props are read from. */
export interface PitcherStartOutcome {
  pitches: number;
  battersFaced: number;
  outs: number;
  strikeouts: number;
  hits_allowed: number;
  pitcher_walks: number;
  home_runs_allowed: number;
  earned_runs: number;
  timesThroughOrder: number;
  removedReason: "pitchCount" | "performance" | "capped" | "completed";
}

/** Volume vs efficiency decomposition surfaced to downstream analysis/UI. */
export interface VolumeEfficiency {
  expectedBattersFaced: number;
  expectedPitches: number;
  expectedOuts: number;
  /** Adjusted per-BF event rates actually used by the simulation. */
  rates: { kPerBf: number; bbPerBf: number; hPerBf: number; hrPerBf: number };
}

/** Pairwise correlation between two props from the JOINT samples (never marginals). */
export interface PropCorrelation {
  a: PitcherJointProp;
  b: PitcherJointProp;
  pearson: number;
}

/** The full joint-simulation result — distributions + retained joint samples. */
export interface PitcherJointSimulation {
  version: string;
  seed: string;
  iterations: number;
  usage: PitcherUsageProjection;
  volumeEfficiency: VolumeEfficiency;
  /** Per-prop sample arrays (retained for correlation + threshold evaluation). */
  samples: Record<PitcherJointProp, number[]>;
  /** Per-prop summary (line-independent). */
  summary: Record<PitcherJointProp, DistSummary>;
  correlations: PropCorrelation[];
  /** Already-accumulated live totals folded in (0 for a pregame simulation). */
  liveBaseline?: Partial<Record<PitcherJointProp, number>>;
  generatedAt: number;
}

/** Adjusted per-BF rates the simulator draws from (pitcher's ALLOWED rates). */
export type PitcherRates = PaRates;
