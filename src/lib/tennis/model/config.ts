/* ============================================================================
   Tennis quantitative-engine configuration. EVERY tunable weight, baseline,
   scoring rule, and threshold lives here — the simulator, feature builder, and
   recommendation layer read from this object, never from inline magic numbers.
   This makes the model testable (swap a config in a test) and reproducible (the
   config checksum is stored on every prediction).

   Baselines are tour-level averages drawn from public aggregate tennis stats and
   are intentionally conservative priors for Bayesian shrinkage — not fabricated
   per-player data. They are documented so they can be recalibrated.
   ========================================================================== */

import type { Surface } from "../domain";

/** Scoring rules — NOT all tournaments share final-set behavior. */
export interface TennisScoringRules {
  bestOf: 3 | 5;
  gamesPerSet: number; // 6
  /** Games each player must reach to trigger a set tiebreak (usually 6). */
  tiebreakAt: number;
  /** Points to win a normal-set tiebreak (first to N, win by 2). */
  tiebreakPoints: number;
  /** Whether the deciding set is played to a tiebreak (vs an advantage set). */
  finalSetTiebreak: boolean;
  /** Points to win the deciding-set tiebreak (e.g. 10 on most tours today). */
  finalSetTiebreakPoints: number;
}

/** Serve-point combination-model weights (logit space). See servePoint.ts. */
export interface ServePointWeights {
  /** Weight on the surface baseline logit. */
  base: number;
  /** Weight on how much the server's serve strength exceeds baseline. */
  server: number;
  /** Weight on how much the returner's return strength exceeds baseline. */
  returner: number;
  /** Weight on the Elo difference term. */
  elo: number;
  /** Elo points that equal one logit unit in the serve-point model. */
  eloScale: number;
  /** Realistic lower/upper bounds for a serve-point-win probability. */
  minP: number;
  maxP: number;
}

export interface AceDfConfig {
  /** Estimated points played per service game (converts per-game → per-point). */
  pointsPerServiceGame: number;
  /** Multiplier applied to a player's ace rate by surface (fast courts ↑). */
  aceSurfaceMult: Record<Surface, number>;
  /** How strongly a strong-returning opponent suppresses aces (0 = none). */
  aceOpponentReturnAdj: number;
  /** Hard caps so ace+DF can never dominate a service point. */
  maxAceProb: number;
  maxDfProb: number;
}

export interface ShrinkConfig {
  /** Pseudo-count (in service games) for serve-rate shrinkage. */
  serveK: number;
  /** Pseudo-count (in return games) for return-rate shrinkage. */
  returnK: number;
  /** Pseudo-count (in matches) for count-rate shrinkage (aces/DF). */
  countK: number;
}

export interface RecommendationThresholds {
  /** |P(more) − 0.5| needed, together with confidence/quality, for STRONG. */
  strongEdge: number;
  /** …for a LEAN. */
  leanEdge: number;
  minConfidence: number;
  minDataQuality: number;
  /** Volatility (CV) above which we refuse a strong pick. */
  highVolatility: number;
  /** Minimum usable sample size before AVOID_LOW_DATA. */
  minSampleSize: number;
}

export interface TennisModelConfig {
  scoring: TennisScoringRules;
  /** Average service-points-won on each surface (tour baseline prior). */
  surfaceServeBaseline: Record<Surface, number>;
  servePoint: ServePointWeights;
  aceDf: AceDfConfig;
  shrink: ShrinkConfig;
  thresholds: RecommendationThresholds;
  /** Global rate priors for shrinkage of observed features. */
  priors: {
    servicePointsWon: number;
    returnPointsWon: number;
    holdPct: number;
    breakPct: number;
    acesPerServiceGame: number;
    dfPerServiceGame: number;
    firstServePct: number;
    firstServeWonPct: number;
    secondServeWonPct: number;
  };
  /** Recency EWMA alpha for recency-weighted feature variants. */
  recencyAlpha: number;
}

export const DEFAULT_SCORING: TennisScoringRules = {
  bestOf: 3,
  gamesPerSet: 6,
  tiebreakAt: 6,
  tiebreakPoints: 7,
  finalSetTiebreak: true,
  finalSetTiebreakPoints: 10,
};

export const DEFAULT_TENNIS_CONFIG: TennisModelConfig = {
  scoring: DEFAULT_SCORING,
  // Service-points-won tour averages (~64% hard, slightly lower clay, higher grass).
  surfaceServeBaseline: { hard: 0.645, clay: 0.632, grass: 0.66, carpet: 0.66 },
  servePoint: { base: 1, server: 0.9, returner: 0.9, elo: 0.18, eloScale: 400, minP: 0.5, maxP: 0.86 },
  aceDf: {
    pointsPerServiceGame: 6.4,
    aceSurfaceMult: { hard: 1.0, clay: 0.82, grass: 1.18, carpet: 1.12 },
    aceOpponentReturnAdj: 0.5,
    maxAceProb: 0.35,
    maxDfProb: 0.15,
  },
  shrink: { serveK: 40, returnK: 40, countK: 6 },
  thresholds: {
    strongEdge: 0.09,
    leanEdge: 0.04,
    minConfidence: 55,
    minDataQuality: 50,
    highVolatility: 0.9,
    minSampleSize: 5,
  },
  priors: {
    servicePointsWon: 0.64,
    returnPointsWon: 0.36,
    holdPct: 0.79,
    breakPct: 0.21,
    acesPerServiceGame: 0.55,
    dfPerServiceGame: 0.28,
    firstServePct: 0.62,
    firstServeWonPct: 0.72,
    secondServeWonPct: 0.5,
  },
  recencyAlpha: 0.35,
};

/** Deep-freeze helper so the default config can't be mutated by consumers. */
export function freezeConfig(c: TennisModelConfig): TennisModelConfig {
  return JSON.parse(JSON.stringify(c)) as TennisModelConfig;
}
