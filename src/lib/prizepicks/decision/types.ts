/* ============================================================================
   Firm PrizePicks decision engine — canonical types. Every candidate leg and
   complete entry resolves to exactly one of five FINAL decision states. A "firm
   decision" means explicit, versioned, testable rules applied to the available
   data — NOT certainty and NOT guaranteed profit. The engine is conservative and
   is expected to reject most lines.
   ========================================================================== */

import { z } from "zod";

export const finalDecisionSchema = z.enum(["BET_MORE", "BET_LESS", "WAIT", "NO_BET", "UNAVAILABLE"]);
export type FinalDecision = z.infer<typeof finalDecisionSchema>;

/** Per-leg analytical direction — distinct from the final ENTRY action. */
export const legCandidateSchema = z.enum([
  "MORE_CANDIDATE",
  "LESS_CANDIDATE",
  "REJECTED",
  "WAITING",
  "UNAVAILABLE",
]);
export type LegCandidate = z.infer<typeof legCandidateSchema>;

export const reasonCategorySchema = z.enum([
  "PROBABILITY", "CONFIDENCE", "DATA_QUALITY", "FRAGILITY", "VOLATILITY", "LINEUP",
  "PITCHER", "MAPPING", "FRESHNESS", "PAYOUT", "ENTRY_EV", "CORRELATION",
  "MODEL_VALIDATION", "PROVIDER", "MARKET",
]);
export type ReasonCategory = z.infer<typeof reasonCategorySchema>;

export const decisionReasonSchema = z.object({
  code: z.string(),
  category: reasonCategorySchema,
  severity: z.enum(["INFO", "WARNING", "CRITICAL"]),
  message: z.string(),
  actualValue: z.union([z.number(), z.string(), z.boolean(), z.null()]).optional(),
  requiredValue: z.union([z.number(), z.string(), z.boolean(), z.null()]).optional(),
});
export type DecisionReason = z.infer<typeof decisionReasonSchema>;

export const decisionVetoSchema = z.object({
  code: z.string(),
  message: z.string(),
  blocking: z.literal(true),
});
export type DecisionVeto = z.infer<typeof decisionVetoSchema>;

export const marketValidationStateSchema = z.enum([
  "RESEARCH_ONLY",
  "PROVISIONAL",
  "VALIDATED",
  "SUSPENDED",
]);
export type MarketValidationState = z.infer<typeof marketValidationStateSchema>;

export const decisionPolicySchema = z.object({
  id: z.string(),
  version: z.string(),
  effectiveFrom: z.string(),
  effectiveTo: z.string().optional(),

  minimumSelectedSideProbability: z.number(),
  minimumConfidence: z.number(),
  minimumDataQuality: z.number(),
  maximumFragility: z.number(),
  maximumVolatility: z.number().optional(),

  minimumEntryExpectedReturn: z.number(),
  maximumLineAgeMinutes: z.number(),

  requireConfirmedPlayer: z.boolean(),
  requireConfirmedGame: z.boolean(),
  requireConfirmedLineupForHitters: z.boolean(),
  requireConfirmedPitcher: z.boolean(),
  requirePayoutTable: z.boolean(),
  requirePregameSnapshot: z.boolean(),
  requireNoCriticalWarnings: z.boolean(),

  minimumForwardSampleByMarket: z.number().optional(),
  minimumCalibrationGrade: z.string().optional(),

  source: z.enum(["application-config", "admin-config"]),
  createdAt: z.string(),
});
export type DecisionPolicy = z.infer<typeof decisionPolicySchema>;

export const decisionResultSchema = z.object({
  decision: finalDecisionSchema,
  subjectType: z.enum(["LEG", "ENTRY"]),
  playerId: z.number().optional(),
  gamePk: z.number().optional(),
  market: z.string().optional(),
  line: z.number().optional(),

  selectedSideProbability: z.number().optional(),
  probabilityMore: z.number().optional(),
  probabilityLess: z.number().optional(),
  probabilityPush: z.number().optional(),

  confidenceScore: z.number().optional(),
  dataQualityScore: z.number().optional(),
  volatilityScore: z.number().optional(),
  fragilityScore: z.number().optional(),

  entryExpectedReturn: z.number().nullable().optional(),
  entryExpectedProfit: z.number().nullable().optional(),
  entryVariance: z.number().nullable().optional(),
  downsideProbability: z.number().nullable().optional(),

  payoutTableId: z.string().nullable().optional(),
  payoutTableVersion: z.string().nullable().optional(),
  decisionPolicyId: z.string(),
  decisionPolicyVersion: z.string(),
  modelVersion: z.string(),
  configChecksum: z.string(),
  marketValidationState: marketValidationStateSchema.optional(),
  method: z.enum(["joint-simulation", "independence-approximation"]).optional(),

  generatedAt: z.string(),
  featureCutoff: z.string(),
  dataAsOf: z.string(),
  lineCapturedAt: z.string().optional(),

  reasons: z.array(decisionReasonSchema),
  vetoes: z.array(decisionVetoSchema),
  releaseConditions: z.array(z.string()).optional(),
  nextReviewAt: z.string().nullable().optional(),
});
export type DecisionResult = z.infer<typeof decisionResultSchema>;
