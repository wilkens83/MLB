/* ============================================================================
   The validated assistant response. The orchestrator ALWAYS returns this exact
   shape (or a typed error), and the API route validates it before sending, so a
   malformed model/composer output can never reach the client.
   ========================================================================== */

import { z } from "zod";
import { chatResponseBlockSchema } from "./blocks";
import { dataSourceReferenceSchema } from "./sources";

export const chatAssistantResponseSchema = z.object({
  /** Short user-facing answer (plain text; no hidden reasoning). */
  answer: z.string(),
  title: z.string().optional(),
  blocks: z.array(chatResponseBlockSchema),
  sources: z.array(dataSourceReferenceSchema),
  warnings: z.array(z.string()),
  suggestedQuestions: z.array(z.string()),
  /** ISO timestamp the response was generated. */
  generatedAt: z.string(),
  /** Diamond Edge model/engine version behind any projection in this answer. */
  modelVersion: z.string().optional(),
  /** Resolved date context (YYYY-MM-DD) the answer is scoped to, if any. */
  dataAsOf: z.string().optional(),
  meta: z
    .object({
      provider: z.string(),
      model: z.string().optional(),
      toolsUsed: z.array(z.string()),
      developmentMode: z.boolean().optional(),
    })
    .optional(),
});
export type ChatAssistantResponse = z.infer<typeof chatAssistantResponseSchema>;

/** A single tool invocation record, surfaced to the UI as "tool status". */
export const toolCallRecordSchema = z.object({
  toolName: z.string(),
  status: z.enum(["ok", "error", "empty"]),
  durationMs: z.number(),
  label: z.string(),
  rowCount: z.number().optional(),
});
export type ToolCallRecord = z.infer<typeof toolCallRecordSchema>;
