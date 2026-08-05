/* ============================================================================
   Workflow-trace + prediction-version contracts (Zod). The trace is the audit
   record of one workflow execution; PredictionVersion ties a result to the exact
   inputs that produced it. Pure (zod only).
   ========================================================================== */

import { z } from "zod";

export const nodeStatusSchema = z.enum([
  "ok", "skipped", "degraded", "failed", "timeout", "cancelled",
]);
export type NodeStatus = z.infer<typeof nodeStatusSchema>;

export const costCategorySchema = z.enum(["cpu", "io", "simulation", "external-api"]);
export type CostCategory = z.infer<typeof costCategorySchema>;

export const cacheStatusSchema = z.enum(["hit", "miss", "stale", "bypass"]);

export const nodeTraceSchema = z.object({
  id: z.string(),
  status: nodeStatusSchema,
  attempts: z.number().int().nonnegative(),
  startedAt: z.number(),
  completedAt: z.number(),
  durationMs: z.number().nonnegative(),
  warnings: z.array(z.string()).default([]),
  errorCode: z.string().optional(),
  cost: costCategorySchema,
  cacheStatus: cacheStatusSchema.optional(),
  apiCalls: z.number().int().nonnegative().optional(),
  simulationCount: z.number().int().nonnegative().optional(),
});
export type NodeTrace = z.infer<typeof nodeTraceSchema>;

export const workflowTraceSchema = z.object({
  workflowId: z.string(),
  executionId: z.string(),
  status: z.enum(["ok", "degraded", "failed", "cancelled", "budget-exceeded"]),
  gameId: z.number().int().optional(),
  playerId: z.number().int().optional(),
  marketId: z.string().optional(),
  startedAt: z.number(),
  completedAt: z.number(),
  durationMs: z.number().nonnegative(),
  nodes: z.array(nodeTraceSchema),
  warnings: z.array(z.string()).default([]),
});
export type WorkflowTrace = z.infer<typeof workflowTraceSchema>;

export const predictionVersionSchema = z.object({
  version: z.string(),
  inputHash: z.string(),
  generatedAt: z.string(),
  featureCutoff: z.string().optional(),
  supersedesId: z.string().nullable().optional(),
});
export type PredictionVersion = z.infer<typeof predictionVersionSchema>;
