/* ============================================================================
   Firm PrizePicks decision engine — canonical types. Every candidate leg and
   complete entry resolves to exactly one of five FINAL decision states. A "firm
   decision" means explicit, versioned, testable rules applied to the available
   data — NOT certainty and NOT guaranteed profit. The engine is conservative and
   is expected to reject most lines.
   ========================================================================== */

import { z } from "zod";

/** Leg-level final decisions (directional). */
export const finalDecisionSchema = z.enum(["BET_MORE", "BET_LESS", "WAIT", "NO_BET", "UNAVAILABLE"]);
export type FinalDecision = z.infer<typeof finalDecisionSchema>;

/**
 * Entry-level final decisions. A complete (possibly mixed-direction) entry is
 * never labeled BET_MORE just because it contains a More leg — a bettable entry
 * is APPROVE_ENTRY. The blocking states are shared with leg decisions.
 */
export const entryDecisionSchema = z.enum(["APPROVE_ENTRY", "WAIT", "NO_BET", "UNAVAILABLE"]);
export type EntryDecisionState = z.infer<typeof entryDecisionSchema>;

/** Any decision value (leg or entry) — used by the persisted DecisionResult. */
export const anyDecisionSchema = z.enum([
  "BET_MORE", "BET_LESS", "APPROVE_ENTRY", "WAIT", "NO_BET", "UNAVAILABLE",
]);
export type AnyDecision = z.infer<typeof anyDecisionSchema>;

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

/** Full model-lifecycle states. Only VALIDATED / PRODUCTION (and PROVISIONAL by
    explicit policy) are eligible for firm BET decisions. */
export const marketValidationStateSchema = z.enum([
  "DEVELOPMENT",
  "BACKTEST_ONLY",
  "SHADOW",
  "RESEARCH_ONLY",
  "PROVISIONAL",
  "VALIDATED",
  "PRODUCTION",
  "SUSPENDED",
  "RETIRED",
]);
export type MarketValidationState = z.infer<typeof marketValidationStateSchema>;

/** Whether a model-validation state may produce a firm BET. PROVISIONAL requires
    the explicit `allowProvisional` policy toggle + stricter thresholds. */
export function isBetEligibleState(state: MarketValidationState, allowProvisional = false): boolean {
  if (state === "VALIDATED" || state === "PRODUCTION") return true;
  if (state === "PROVISIONAL") return allowProvisional;
  return false; // DEVELOPMENT / BACKTEST_ONLY / SHADOW / RESEARCH_ONLY / SUSPENDED / RETIRED
}

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
  /** When true, PROVISIONAL markets may produce firm BET (stricter thresholds). */
  allowProvisionalMarkets: z.boolean().optional(),

  source: z.enum(["application-config", "admin-config"]),
  createdAt: z.string(),
});
export type DecisionPolicy = z.infer<typeof decisionPolicySchema>;

export const decisionResultSchema = z.object({
  decision: anyDecisionSchema,
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
  payoutVerified: z.boolean().optional(),
  decisionPolicyId: z.string(),
  decisionPolicyVersion: z.string(),
  modelVersion: z.string(),
  configChecksum: z.string(),
  marketValidationState: marketValidationStateSchema.optional(),
  method: z.enum(["joint-simulation", "independence-approximation"]).optional(),

  generatedAt: z.string(),
  featureCutoff: z.string(),
  dataAsOf: z.string(),
  /** Scheduled event start — point-in-time boundary for leakage checks. */
  eventStartTime: z.string().optional(),
  lineCapturedAt: z.string().optional(),
  /** Hash of the exact decision inputs, for reproducibility/audit. */
  inputHash: z.string().optional(),

  reasons: z.array(decisionReasonSchema),
  vetoes: z.array(decisionVetoSchema),
  releaseConditions: z.array(z.string()).optional(),
  nextReviewAt: z.string().nullable().optional(),
}).superRefine((r, ctx) => {
  // A leg is never APPROVE_ENTRY; an entry is never a directional BET_MORE/BET_LESS.
  if (r.subjectType === "LEG" && r.decision === "APPROVE_ENTRY") {
    ctx.addIssue({ code: z.ZodIssueCode.custom, message: "LEG cannot be APPROVE_ENTRY" });
  }
  if (r.subjectType === "ENTRY" && (r.decision === "BET_MORE" || r.decision === "BET_LESS")) {
    ctx.addIssue({ code: z.ZodIssueCode.custom, message: "ENTRY cannot be BET_MORE/BET_LESS; use APPROVE_ENTRY" });
  }
});
export type DecisionResult = z.infer<typeof decisionResultSchema>;
