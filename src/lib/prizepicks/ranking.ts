/* ============================================================================
   Experimental candidate ranking + signal classification. Produces a 0–100
   "Experimental candidate score" (NOT a win probability) and a Strong/Lean/
   Watch/Avoid signal. Weights are documented in
   docs/prizepicks-integration/ranking-methodology.md and are configurable.

   Until validated by backtesting, callers MUST label the score experimental and
   never describe a candidate as guaranteed/certain/winning.
   ========================================================================== */

import { clamp, round } from "@/lib/utils";
import type { CandidateEvaluation } from "./types";

export interface RankingWeights {
  probability: number; // max contribution
  dataQuality: number;
  modelAgreement: number;
  freshness: number;
  uncertaintyPenalty: number;
  warningHigh: number;
  warningWarn: number;
  roleUncertaintyPenalty: number;
}

export const DEFAULT_WEIGHTS: RankingWeights = {
  probability: 45,
  dataQuality: 20,
  modelAgreement: 15,
  freshness: 10,
  uncertaintyPenalty: 15,
  warningHigh: 12,
  warningWarn: 4,
  roleUncertaintyPenalty: 8,
};

export type Direction = "more" | "less";
export type Signal = "strong" | "lean" | "watch" | "avoid";

export interface RankingResult {
  score: number; // 0..100 experimental
  direction: Direction;
  directionalProb: number;
  signal: Signal;
  components: Record<string, number>;
}

const ROLE_WARNINGS = new Set(["unconfirmed_lineup", "uncertain_starter", "role_uncertainty"]);
const CRITICAL_WARNINGS = new Set([
  "unresolved_player", "game_unresolved", "post_start", "stale_line", "conflicting_game",
]);

export interface RankingContext {
  /** Age of the imported line in ms (for freshness). */
  lineAgeMs?: number;
  /** Whether the player+game resolved cleanly. */
  resolved: boolean;
  weights?: RankingWeights;
}

function freshnessScore(lineAgeMs: number | undefined, max: number): number {
  if (lineAgeMs === undefined) return max * 0.5;
  const h = lineAgeMs / 3_600_000;
  if (h < 2) return max;
  if (h < 6) return max * 0.6;
  if (h < 12) return max * 0.3;
  return 0;
}

export function computeRanking(evaln: CandidateEvaluation, ctx: RankingContext): RankingResult {
  const w = ctx.weights ?? DEFAULT_WEIGHTS;
  const direction: Direction = evaln.probMore >= evaln.probLess ? "more" : "less";
  const directionalProb = Math.max(evaln.probMore, evaln.probLess);

  const probabilityComponent = clamp((directionalProb - 0.5) * 2 * w.probability, 0, w.probability);
  const dataQualityComponent = clamp((evaln.dataQuality / 100) * w.dataQuality, 0, w.dataQuality);
  const modelAgreementComponent = clamp(evaln.modelAgreement * w.modelAgreement, 0, w.modelAgreement);
  const freshnessComponent = freshnessScore(ctx.lineAgeMs, w.freshness);

  // Uncertainty penalty rises as sample shrinks (saturating ~25 games).
  const sampleFactor = 1 - Math.exp(-evaln.sampleSize / 12);
  const uncertaintyPenalty = (1 - sampleFactor) * w.uncertaintyPenalty;

  const highs = evaln.warnings.filter((x) => x.severity === "high").length;
  const warns = evaln.warnings.filter((x) => x.severity === "warn").length;
  const warningPenalty = Math.min(highs * w.warningHigh, w.warningHigh * 2) + Math.min(warns * w.warningWarn, w.warningWarn * 3);

  const hasRoleUncertainty = evaln.warnings.some((x) => ROLE_WARNINGS.has(x.code));
  const roleUncertaintyPenalty = hasRoleUncertainty ? w.roleUncertaintyPenalty : 0;

  const rawScore =
    probabilityComponent +
    dataQualityComponent +
    modelAgreementComponent +
    freshnessComponent -
    uncertaintyPenalty -
    warningPenalty -
    roleUncertaintyPenalty;

  const score = clamp(round(rawScore, 0), 0, 100);

  const signal = classifySignal(evaln, ctx, directionalProb, score);

  return {
    score,
    direction,
    directionalProb: round(directionalProb, 4),
    signal,
    components: {
      probability: round(probabilityComponent, 1),
      dataQuality: round(dataQualityComponent, 1),
      modelAgreement: round(modelAgreementComponent, 1),
      freshness: round(freshnessComponent, 1),
      uncertaintyPenalty: round(-uncertaintyPenalty, 1),
      warningPenalty: round(-warningPenalty, 1),
      roleUncertaintyPenalty: round(-roleUncertaintyPenalty, 1),
    },
  };
}

export interface SignalThresholds {
  strongProb: number;
  strongDataQuality: number;
  strongAgreement: number;
  leanProb: number;
  leanDataQuality: number;
  watchProb: number;
}

export const DEFAULT_THRESHOLDS: SignalThresholds = {
  strongProb: 0.6,
  strongDataQuality: 70,
  strongAgreement: 0.6,
  leanProb: 0.55,
  leanDataQuality: 45,
  watchProb: 0.52,
};

export function classifySignal(
  evaln: CandidateEvaluation,
  ctx: RankingContext,
  directionalProb: number,
  _score: number,
  t: SignalThresholds = DEFAULT_THRESHOLDS,
): Signal {
  const hasCritical = evaln.warnings.some((x) => x.severity === "high" && CRITICAL_WARNINGS.has(x.code));
  // Unresolved entries or any critical warning can never be Strong.
  if (!ctx.resolved || hasCritical || evaln.dataQuality < 30) return "avoid";

  const noCritical = !evaln.warnings.some((x) => x.severity === "high");
  const hasRoleUncertainty = evaln.warnings.some((x) => ROLE_WARNINGS.has(x.code));

  if (
    directionalProb >= t.strongProb &&
    evaln.dataQuality >= t.strongDataQuality &&
    evaln.modelAgreement >= t.strongAgreement &&
    noCritical &&
    !hasRoleUncertainty &&
    evaln.pregame
  ) {
    return "strong";
  }
  if (directionalProb >= t.leanProb && evaln.dataQuality >= t.leanDataQuality && noCritical) return "lean";
  if (directionalProb >= t.watchProb) return "watch";
  return "avoid";
}
