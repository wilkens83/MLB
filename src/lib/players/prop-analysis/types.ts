/* ============================================================================
   PlayerPropAnalysisViewModel — the ONE typed, server-assembled payload the
   research page consumes. The frontend performs NO scientific calculation; it
   only renders these fields. Every optional analytical block degrades to an
   explicit unavailable state rather than a fabricated value.

   Scientific honesty is encoded in the shape:
     * historicalHitRates are HISTORICAL counts, never a probability field.
     * raw vs calibrated probability are DISTINCT and calibrated may be null.
     * percentiles require a reference population, else `available: false`.
     * the decision is the canonical Opportunity Engine status, read not computed.
   ========================================================================== */

import type { MarketAnalysisConfig } from "./market-config";

export interface VmPlayer {
  id: number;
  name: string;
  position: string;
  team: string;
  teamId?: number;
  bats?: string;
  throws?: string;
  isPitcher: boolean;
}

export interface VmGame {
  gamePk?: number;
  venueName?: string;
  opponentTeam?: string;
  opponentTeamId?: number;
  starterConfirmed: boolean;
  lineupConfirmed: boolean;
}

/** One charted game (oldest→newest). `upcoming` marks the next, unplayed game. */
export interface VmHistoryPoint {
  date?: string;
  opponent?: string;
  isHome?: boolean;
  value: number | null;
  /** result vs the selected line — null for pushes and upcoming games. */
  result: "over" | "under" | "push" | null;
  upcoming?: boolean;
}

/** A labeled header metric with an optional delta-vs-baseline (only when real). */
export interface VmMetric {
  key: string;
  label: string;
  value: number | null;
  format: "int" | "one" | "pct" | "era";
  /** Signed delta vs season baseline — present ONLY when a baseline exists. */
  delta?: number;
  deltaGood?: "up" | "down"; // which direction is favorable, for coloring
}

/** HISTORICAL hit rate over a window. NEVER a model probability. */
export interface VmHistoricalHitRate {
  window: "L5" | "L10" | "L20" | "Season";
  games: number;
  hits: number;
  /** over-rate = hits / decided games (pushes excluded). Historical only. */
  overRate: number | null;
}

export interface VmProjection {
  mean: number;
  median: number;
  /** central band [low, high] and the interval label (e.g. "P10–P90"). */
  band: [number, number];
  bandLabel: string;
  /** interquartile projection [p25, p75] in prop units, when derivable. */
  iqr: [number, number] | null;
}

export interface VmScientific {
  rawProbabilityMore: number;
  rawProbabilityLess: number;
  /** Calibrated probability — null when calibration is unavailable (never raw). */
  calibratedProbabilityMore: number | null;
  calibratedProbabilityLess: number | null;
  calibrationAvailable: boolean;
  baselineProbability: number | null;
  /** calibrated selected − baseline, in percentage points; null when either missing. */
  modelAdvantagePp: number | null;
  /** policy minimum selected-side probability the decision engine requires. */
  policyThresholdPct: number;
  side: "more" | "less";
  projection: VmProjection;
  dataQuality: number; // 0..100 (completeness/quality, NOT confidence-as-probability)
  volatility: number; // 0..100 (spread of the projection distribution)
  fragilityScore: number | null;
  fragilityLevel: "LOW" | "MODERATE" | "HIGH" | "EXTREME" | null;
  uncertaintyHalfWidth95: number | null; // Monte-Carlo sampling noise
  modelInputUncertainty: number | null; // plausible-assumption swing
  trainingSupport: "IN-DISTRIBUTION" | "OUTSIDE-SUPPORT" | "UNKNOWN";
  modelLifecycle: string; // e.g. RESEARCH_ONLY / VALIDATED / PRODUCTION
  modelVersion: string;
  featureVersion: string;
  calibrationVersion: string | null;
}

export interface VmDecision {
  status: "QUALIFIED_MORE" | "QUALIFIED_LESS" | "WATCH" | "NO_PLAY" | "UNAVAILABLE" | "NO_ACTIVE_LINE";
  reasons: string[];
  risks: string[];
  /** What would change the verdict — always actionable, never a generic lean. */
  nextReview: string;
  /** True only when a persisted/validated line drove a canonical assessment. */
  fromCanonicalAssessment: boolean;
}

export interface VmLine {
  value: number;
  /** Where the threshold came from. PrizePicks economics kept separate from books. */
  source: "prizepicks" | "manual" | "default";
  capturedAt?: string;
}

export interface VmConditions {
  venueName?: string;
  city?: string;
  weatherAvailable: boolean;
  temperatureF?: number;
  windDescription?: string;
  humidityPct?: number;
  /** Roof status — "unavailable" when the feed does not report it (never assumed open). */
  roof: "open" | "closed" | "retractable" | "unavailable";
  park: { runs: number | null; hr: number | null; hits: number | null };
  classification?: "Hitter Friendly" | "Pitcher Friendly" | "Neutral";
}

/** One row of the player-vs-opponent percentile matchup. */
export interface VmPercentileRow {
  metric: string;
  label: string;
  playerValue: number | null;
  playerPercentile: number | null; // 0..100, null when no reference population
  opponentValue: number | null;
  opponentPercentile: number | null;
  /** which side the edge favors — from percentiles, null when unknown. */
  edge: "pitcher" | "batter" | "neutral" | null;
}

export interface VmMatchup {
  available: boolean;
  /** reference population size behind the percentiles; null when insufficient. */
  referenceSize: number | null;
  rows: VmPercentileRow[];
  /** Left/right column labels (analyzed player vs opponent). */
  leftLabel: string;
  rightLabel: string;
  note?: string;
}

/** Opponent context — the opposing lineup (pitcher prop) or starter (hitter prop). */
export interface VmOpponentContext {
  kind: "lineup" | "starter" | "unavailable";
  team?: string;
  lineupStatus: "confirmed" | "projected" | "unavailable";
  starterName?: string;
  starterHand?: string;
  starterStatus?: "confirmed" | "projected" | "unavailable";
  /** Compact metric readouts (already-percent values), unavailable → null. */
  metrics: VmMetric[];
  note?: string;
}

export interface VmSplit {
  key: string;
  label: string;
  sampleSize: number | null;
  /** True when the split sample is too thin to trust — surfaced as SAMPLE LIMITED. */
  smallSample: boolean;
  metrics: VmMetric[];
}

export interface VmPitchType {
  pitchType: string;
  pitchName: string;
  usage: number | null;
  velo: number | null;
  whiffPct: number | null;
  baAllowed: number | null;
  slgAllowed: number | null;
  xwobaAllowed: number | null;
  /** Matchup indicator derived from whiff/xwOBA vs league — null when unknown. */
  edge: "pitcher" | "neutral" | "batter" | null;
}

export interface VmProvenance {
  dataAsOf: number;
  modelVersion: string;
  sources: { name: string; available: boolean }[];
  lineCapturedAt?: string;
  season: number;
}

export interface PlayerPropAnalysisViewModel {
  ok: boolean;
  /** Top-level fatal state (player/game unresolved). Sections still degrade individually. */
  status: "OK" | "PLAYER_UNAVAILABLE" | "GAME_UNAVAILABLE" | "NO_SERIES_DATA";
  config: MarketAnalysisConfig;
  window: number;
  player: VmPlayer | null;
  game: VmGame | null;
  line: VmLine;
  headerMetrics: VmMetric[];
  history: VmHistoryPoint[];
  historicalHitRates: VmHistoricalHitRate[];
  scientific: VmScientific | null;
  decision: VmDecision;
  conditions: VmConditions | null;
  opponent: VmOpponentContext;
  matchup: VmMatchup;
  splits: VmSplit[];
  pitchTypes: VmPitchType[];
  provenance: VmProvenance;
  warnings: string[];
}
