/* ============================================================================
   Analysis-output contracts (Zod). Projection, simulation, probability, and the
   final recommendation. Refinements encode the numeric invariants the
   verification nodes also assert (defence in depth). Pure (zod only).
   ========================================================================== */

import { z } from "zod";

const unitProb = z.number().finite().min(0).max(1);

export const projectionMethodSchema = z.enum(["plate-appearance", "marginal"]);

export const projectionSchema = z.object({
  /** Estimated rate/mean (lambda for Poisson-family, mean for normal). */
  mean: z.number().finite(),
  method: projectionMethodSchema,
  sampleSize: z.number().int().nonnegative(),
  /** Point-in-time boundary — data after this must not influence the estimate. */
  featureCutoff: z.string().optional(),
});
export type Projection = z.infer<typeof projectionSchema>;

export const simulationResultSchema = z
  .object({
    pOver: unitProb,
    pUnder: unitProb,
    pPush: unitProb,
    mean: z.number().finite(),
    stdDev: z.number().finite().nonnegative(),
    iterations: z.number().int().positive(),
    ci: z.tuple([z.number().finite(), z.number().finite()]).optional(),
  })
  .refine((s) => Math.abs(s.pOver + s.pUnder + s.pPush - 1) < 1e-3, {
    message: "pOver + pUnder + pPush must sum to ~1",
  });
export type SimulationResult = z.infer<typeof simulationResultSchema>;

export const probabilityEstimateSchema = z.object({
  side: z.enum(["over", "under"]),
  probability: unitProb,
  method: z.enum(["empirical", "analytic", "blended"]),
});
export type ProbabilityEstimate = z.infer<typeof probabilityEstimateSchema>;

/** Terminal status of a recommendation — degraded/insufficient states are explicit. */
export const recommendationStatusSchema = z.enum([
  "ok", "insufficient-data", "degraded", "no-price", "rejected",
]);

export const recommendationSchema = z.object({
  status: recommendationStatusSchema,
  side: z.enum(["over", "under"]).optional(),
  probability: unitProb.optional(),
  /** EV/edge only present when a market price was supplied. */
  edge: z.number().finite().optional(),
  ev: z.number().finite().optional(),
  confidence: z.number().finite().min(0).max(100).optional(),
  warnings: z.array(z.string()).default([]),
});
export type Recommendation = z.infer<typeof recommendationSchema>;
