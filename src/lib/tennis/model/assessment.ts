/* ============================================================================
   Prediction assessment — the layer that keeps THREE different questions
   separate, because they are not the same thing:

     PROBABILITY   — how often the simulation beats the line.
     CONFIDENCE    — how much we should trust the estimate.
     DATA QUALITY  — how complete/reliable the inputs are.

   A recommendation requires BOTH a sufficient probability edge AND minimum
   confidence + data-quality (all thresholds configurable). High probability on
   thin/low-quality data can NEVER become a strong pick — it degrades to
   NO_EDGE or AVOID_LOW_DATA. Every assessment carries structured reasons tied to
   actual feature values, plus explicit warnings.
   ========================================================================== */

import { clamp, round } from "@/lib/utils";
import { DEFAULT_TENNIS_CONFIG, type TennisModelConfig } from "./config";
import type { MarketProjection, EngineMarket } from "./markets";
import type { TennisMatchModel } from "./matchModel";
import { buildModelVersion, type TennisModelVersion } from "./version";

export type Recommendation =
  | "STRONG_MORE" | "LEAN_MORE" | "NO_EDGE" | "LEAN_LESS" | "STRONG_LESS"
  | "AVOID_LOW_DATA" | "AVOID_HIGH_VOLATILITY" | "UNAVAILABLE";

export interface PredictionReason {
  factor: string;
  direction: "positive" | "negative" | "neutral";
  magnitude: number; // 0..1 relative importance/size of the effect
  explanation: string;
}

export interface TennisPredictionAssessment {
  market: EngineMarket;
  line: number;
  probabilityMore: number;
  probabilityLess: number;
  probabilityPush: number;
  confidenceScore: number; // 0..100
  dataQualityScore: number; // 0..100
  volatilityScore: number; // 0..100 (higher = noisier)
  recommendation: Recommendation;
  reasons: PredictionReason[];
  warnings: string[];
  modelVersion: TennisModelVersion;
}

export interface AssessmentOptions {
  config?: TennisModelConfig;
  /** 0..1 external provider health (data source reliability). */
  providerQuality?: number;
  /** 0..1 confidence that the player identity was resolved correctly. */
  identityConfidence?: number;
  /** 0..1 quality of external→domain field mapping. */
  mappingQuality?: number;
  /** True if providers disagreed on the underlying data. */
  conflictingProviders?: boolean;
}

const SUBJECT_SIDE = "a" as const;

export function assess(
  projection: MarketProjection,
  model: TennisMatchModel,
  opts: AssessmentOptions = {},
): TennisPredictionAssessment {
  const cfg = opts.config ?? DEFAULT_TENNIS_CONFIG;
  const th = cfg.thresholds;
  const subj = model[SUBJECT_SIDE];

  const providerQuality = opts.providerQuality ?? 0.7;
  const identityConfidence = opts.identityConfidence ?? 1;
  const mappingQuality = opts.mappingQuality ?? 0.8;

  // ---- DATA QUALITY --------------------------------------------------------
  const completeness = numberOr(subj.contextFeatures.dataCompleteness?.value, 0);
  const freshnessDays = subj.serveRates.servicePointsWonPct.freshness;
  const freshnessScore = clamp(1 - freshnessDays / 240, 0, 1); // ≤0 after ~8 months
  const historicalDepth = saturate(subj.sampleSize, 20);
  const missingServeReturn = serveReturnMissing(subj) ? 0 : 1;
  const dataQualityScore = round(100 * weighted([
    [completeness, 0.28],
    [freshnessScore, 0.14],
    [providerQuality, 0.14],
    [mappingQuality, 0.12],
    [historicalDepth, 0.16],
    [opts.conflictingProviders ? 0 : 1, 0.06],
    [missingServeReturn, 0.10],
  ]), 1);

  // ---- CONFIDENCE ----------------------------------------------------------
  const eloStability = eloStabilityScore(model);
  const varianceScore = clamp(1 - projection.volatility / (th.highVolatility * 1.4), 0, 1);
  const calibration = 0.6; // documented constant until a calibration study lands
  const confidenceScore = round(100 * weighted([
    [saturate(subj.sampleSize, 25), 0.22],
    [saturate(subj.surfaceSampleSize, 12), 0.16],
    [freshnessScore, 0.12],
    [completeness, 0.12],
    [providerQuality, 0.06],
    [identityConfidence, 0.08],
    [eloStability, 0.1],
    [calibration, 0.06],
    [varianceScore, 0.08],
  ]), 1);

  const volatilityScore = round(clamp(projection.volatility / th.highVolatility, 0, 1) * 100, 1);

  // ---- RECOMMENDATION (edge AND confidence AND data-quality) --------------
  const edge = projection.probabilityMore - 0.5;
  const recommendation = decide(edge, confidenceScore, dataQualityScore, projection.volatility, subj.sampleSize, th);

  return {
    market: projection.market,
    line: projection.line,
    probabilityMore: projection.probabilityMore,
    probabilityLess: projection.probabilityLess,
    probabilityPush: projection.probabilityPush,
    confidenceScore,
    dataQualityScore,
    volatilityScore,
    recommendation,
    reasons: buildReasons(projection.market, model, cfg),
    warnings: buildWarnings(model, projection, cfg),
    modelVersion: buildModelVersion(cfg),
  };
}

function decide(
  edge: number, confidence: number, dataQuality: number, volatility: number, sampleSize: number,
  th: TennisModelConfig["thresholds"],
): Recommendation {
  if (dataQuality < th.minDataQuality || sampleSize < th.minSampleSize) return "AVOID_LOW_DATA";
  if (volatility > th.highVolatility) return "AVOID_HIGH_VOLATILITY";
  const thresholdsMet = confidence >= th.minConfidence && dataQuality >= th.minDataQuality;
  if (!thresholdsMet) return "NO_EDGE";
  const mag = Math.abs(edge);
  if (edge > 0) {
    if (mag >= th.strongEdge) return "STRONG_MORE";
    if (mag >= th.leanEdge) return "LEAN_MORE";
  } else if (edge < 0) {
    if (mag >= th.strongEdge) return "STRONG_LESS";
    if (mag >= th.leanEdge) return "LEAN_LESS";
  }
  return "NO_EDGE";
}

// ---- reasons + warnings ----------------------------------------------------

function buildReasons(market: EngineMarket, model: TennisMatchModel, cfg: TennisModelConfig): PredictionReason[] {
  const reasons: PredictionReason[] = [];
  const subj = model.a;
  const opp = model.b;
  const surface = surfaceFromContext(model);
  const serveBaseline = cfg.surfaceServeBaseline[surface];

  // Serve dominance.
  const spw = numberOr(subj.serveRates.servicePointsWonPct.value, serveBaseline);
  const spwDelta = spw - serveBaseline;
  if (Math.abs(spwDelta) > 0.005) {
    reasons.push({
      factor: "serve_dominance",
      direction: spwDelta > 0 ? "positive" : "negative",
      magnitude: clamp(Math.abs(spwDelta) * 8, 0, 1),
      explanation: `Service points won ${(spw * 100).toFixed(1)}% vs ${(serveBaseline * 100).toFixed(1)}% ${surface} baseline`,
    });
  }

  if (market === "aces") {
    const aceRate = numberOr(subj.serveRates.acesPerServiceGame.value, cfg.priors.acesPerServiceGame);
    const aceDelta = aceRate - cfg.priors.acesPerServiceGame;
    reasons.push({
      factor: "surface_ace_rate",
      direction: aceDelta > 0 ? "positive" : aceDelta < 0 ? "negative" : "neutral",
      magnitude: clamp(Math.abs(aceDelta), 0, 1),
      explanation: `Ace rate ${aceRate.toFixed(2)}/service game vs ${cfg.priors.acesPerServiceGame.toFixed(2)} tour baseline (surface mult ${cfg.aceDf.aceSurfaceMult[surface]})`,
    });
    const oppReturn = numberOr(opp.returnRates.returnPointsWonPct.value, cfg.priors.returnPointsWon);
    const oppDelta = oppReturn - cfg.priors.returnPointsWon;
    reasons.push({
      factor: "opponent_return",
      direction: oppDelta < 0 ? "positive" : "negative", // weak returner → more aces
      magnitude: clamp(Math.abs(oppDelta) * 5, 0, 1),
      explanation: `Opponent return points won ${(oppReturn * 100).toFixed(1)}% vs ${(cfg.priors.returnPointsWon * 100).toFixed(1)}% baseline`,
    });
  }

  if (market === "double_faults") {
    const df = numberOr(subj.serveRates.dfPerServiceGame.value, cfg.priors.dfPerServiceGame);
    const d = df - cfg.priors.dfPerServiceGame;
    reasons.push({
      factor: "double_fault_rate",
      direction: d > 0 ? "positive" : "negative",
      magnitude: clamp(Math.abs(d) * 2, 0, 1),
      explanation: `Double faults ${df.toFixed(2)}/service game vs ${cfg.priors.dfPerServiceGame.toFixed(2)} baseline`,
    });
  }

  if (market === "total_games" || market === "total_sets" || market === "sets_won" || market === "games_won" || market === "tie_breaks") {
    const eloEdge = subj.overallElo - opp.overallElo;
    if (Math.abs(eloEdge) > 5) {
      reasons.push({
        factor: "elo_edge",
        direction: eloEdge > 0 ? "positive" : "negative",
        magnitude: clamp(Math.abs(eloEdge) / 400, 0, 1),
        explanation: `Elo ${subj.overallElo.toFixed(0)} vs ${opp.overallElo.toFixed(0)} (Δ${eloEdge.toFixed(0)})`,
      });
    }
    const bothStrong = subj.servePointWinProb > serveBaseline && opp.servePointWinProb > cfg.surfaceServeBaseline[surface];
    if (bothStrong && (market === "total_games" || market === "tie_breaks")) {
      reasons.push({
        factor: "mutual_serve_strength",
        direction: "positive",
        magnitude: clamp((subj.servePointWinProb + opp.servePointWinProb - 2 * serveBaseline) * 6, 0, 1),
        explanation: "Both players hold serve well → longer sets, more tiebreaks",
      });
    }
  }

  return reasons;
}

function buildWarnings(model: TennisMatchModel, projection: MarketProjection, cfg: TennisModelConfig): string[] {
  const out: string[] = [];
  const subj = model.a;
  if (subj.surfaceSampleSize < 5) out.push(`Only ${subj.surfaceSampleSize} same-surface matches in the window.`);
  if (subj.sampleSize < cfg.thresholds.minSampleSize) out.push(`Thin history: ${subj.sampleSize} matches.`);
  if (serveReturnMissing(subj)) out.push("Serve/return data incomplete — rates fall back to priors.");
  if (serveReturnMissing(model.b)) out.push("Opponent serve/return sample incomplete.");
  const indoor = model.a.contextFeatures.indoor;
  if (indoor?.value === null) out.push("Indoor/outdoor status unavailable.");
  if (projection.volatility > cfg.thresholds.highVolatility) out.push(`High outcome volatility (CV ${projection.volatility.toFixed(2)}).`);
  if (subj.overallElo === 1500 && subj.sampleSize === 0) out.push("No rated matches — Elo at default 1500.");
  return out;
}

// ---- helpers ---------------------------------------------------------------

function weighted(pairs: [number, number][]): number {
  let acc = 0, w = 0;
  for (const [v, weight] of pairs) { acc += clamp(v, 0, 1) * weight; w += weight; }
  return w > 0 ? acc / w : 0;
}
function saturate(n: number, scale: number): number {
  return clamp(1 - Math.exp(-n / scale), 0, 1);
}
function numberOr(v: number | null | undefined, fallback: number): number {
  return v === null || v === undefined ? fallback : v;
}
function serveReturnMissing(side: TennisMatchModel["a"]): boolean {
  return side.serveRates.servicePointsWonPct.source.includes("prior") ||
    side.serveRates.acesPerServiceGame.source.includes("prior");
}
function eloStabilityScore(model: TennisMatchModel): number {
  // Stability grows with rated matches; default rating (no matches) → low.
  const a = model.a.sampleSize, b = model.b.sampleSize;
  return saturate(Math.min(a, b), 15);
}
function surfaceFromContext(model: TennisMatchModel): "hard" | "clay" | "grass" | "carpet" {
  const code = model.a.contextFeatures.surface?.value ?? 0;
  return (["hard", "clay", "grass", "carpet"] as const)[code] ?? "hard";
}
