/* Player-prop workflow — input, injected dependencies, and node I/O schemas.
   The workflow receives its data adapter by INJECTION (getSeries), so it never
   imports a concrete network client and stays offline-testable with fixtures. */

import { z } from "zod";
import { projectionSchema, simulationResultSchema, recommendationSchema } from "@/schemas/analysis";
import { verificationResultSchema } from "@/schemas/verification";

export const playerPropInputSchema = z.object({
  playerId: z.number().int().positive(),
  propKey: z.string(),
  line: z.number().finite().optional(),
  side: z.enum(["over", "under"]).optional(),
  overAmerican: z.number().int().optional(),
  underAmerican: z.number().int().optional(),
  season: z.number().int().optional(),
  seed: z.string().optional(),
  iterations: z.number().int().min(1000).max(200_000).optional(),
  minSample: z.number().int().min(1).max(500).optional(),
});
export type PlayerPropInput = z.infer<typeof playerPropInputSchema>;

/** Point-in-time series for a (player, prop), produced by an injected adapter. */
export const seriesResultSchema = z.object({
  series: z.array(z.number().finite()),
  sampleSize: z.number().int().nonnegative(),
  featureCutoff: z.string().optional(),
  eventStartTime: z.string().optional(),
  lineupConfirmed: z.boolean().optional(),
  starterConfirmed: z.boolean().optional(),
});
export type SeriesResult = z.infer<typeof seriesResultSchema>;

export interface PlayerPropDeps {
  /** Load the point-in-time numeric series for a player+prop (adapter). */
  getSeries: (input: PlayerPropInput) => Promise<SeriesResult>;
}

/* ---- node output schemas ---- */

export const sampleQualityOutputSchema = z.object({
  sufficient: z.boolean(),
  sampleSize: z.number().int().nonnegative(),
  minSample: z.number().int(),
});

export const priceCompareOutputSchema = z.object({
  hasPrice: z.boolean(),
  side: z.enum(["over", "under"]),
  modelProbability: z.number().min(0).max(1),
  edge: z.number().finite().optional(),
  ev: z.number().finite().optional(),
  confidence: z.number().min(0).max(100),
});

export { projectionSchema, simulationResultSchema, recommendationSchema, verificationResultSchema };
