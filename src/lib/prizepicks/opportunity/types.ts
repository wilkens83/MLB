/* ============================================================================
   CanonicalOpportunityAssessment — the Opportunity Engine's verdict on whether a
   verified PrizePicks line contains enough VERIFIED evidence to be actionable.
   Raw and calibrated probabilities are kept as DISTINCT fields; the decision uses
   the calibrated one, and refuses to qualify when calibration is unavailable.
   ========================================================================== */

import { z } from "zod";

export const opportunityStatusSchema = z.enum([
  "UNAVAILABLE", "NO_PLAY", "WATCH", "QUALIFIED_MORE", "QUALIFIED_LESS",
]);
export type OpportunityStatus = z.infer<typeof opportunityStatusSchema>;

export const scientificVetoSchema = z.object({ code: z.string(), message: z.string() });

export const canonicalOpportunityAssessmentSchema = z.object({
  // identity
  lineSnapshotId: z.string(),
  playerId: z.number().int().optional(),
  gamePk: z.number().int().optional(),
  market: z.string(),
  line: z.number(),
  side: z.enum(["more", "less"]).optional(),

  // probabilities — raw and calibrated are DISTINCT
  rawProbabilityMore: z.number(),
  rawProbabilityLess: z.number(),
  rawProbabilityPush: z.number(),
  /** Undefined when calibration is unavailable — never silently set to raw. */
  calibratedProbabilityMore: z.number().optional(),
  calibratedProbabilityLess: z.number().optional(),
  calibrationAvailable: z.boolean(),

  // projection
  projectionMean: z.number(),
  projectionMedian: z.number(),

  // independent edge
  baselineProbability: z.number().optional(),
  modelAdvantage: z.number().optional(),

  // uncertainty / robustness
  uncertaintyLow: z.number(),
  uncertaintyHigh: z.number(),
  dataQuality: z.number(),
  trainingSupport: z.number(),
  modelLifecycleState: z.string(),
  fragility: z.number(),
  volatility: z.number(),

  // status inputs
  lineupStatus: z.enum(["confirmed", "projected", "not_required"]),
  starterStatus: z.enum(["confirmed", "projected", "not_relevant"]),
  dataFreshness: z.enum(["fresh", "stale", "unknown"]),

  // verdict
  scientificVetoes: z.array(scientificVetoSchema),
  status: opportunityStatusSchema,
  reasonCodes: z.array(z.string()),

  // provenance — exact versions the assessment was produced from
  generatedAt: z.string(),
  modelVersion: z.string(),
  calibrationVersion: z.string(),
  featureVersion: z.string(),
});
export type CanonicalOpportunityAssessment = z.infer<typeof canonicalOpportunityAssessmentSchema>;
