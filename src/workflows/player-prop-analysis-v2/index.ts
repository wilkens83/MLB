/* ============================================================================
   player-prop-analysis@2 — a focused graph workflow that assembles the research
   PlayerPropAnalysisViewModel. It REUSES the existing analysis engine and the
   scientific engines (via `assemblePropAnalysis`); the graph orchestrates the
   request → assemble → view-model flow on the shared executor so the run carries
   a full WorkflowTrace and typed Result. No projection/simulation engine is
   duplicated here.
   ========================================================================== */

import { z } from "zod";
import { defineNode } from "../graph/node";
import { ok, err, type Result } from "../graph/result";
import { validationError } from "../graph/errors";
import { runWorkflow, type Workflow, type RunOptions } from "../graph/executor";
import type { WorkflowTrace } from "@/schemas/workflow";
import { assemblePropAnalysis, type PropAnalysisRequest } from "@/lib/players/prop-analysis/assemble";
import type { PlayerPropAnalysisViewModel } from "@/lib/players/prop-analysis/types";

export const PLAYER_PROP_ANALYSIS_V2_ID = "player-prop-analysis@2";

const requestSchema = z.object({
  playerId: z.number().int().positive(),
  market: z.string().min(1),
  line: z.number().optional(),
  window: z.number().int().positive().optional(),
  lineSource: z.enum(["prizepicks", "manual", "default"]).optional(),
  lineCapturedAt: z.string().optional(),
});

const inputSchema = z.object({ request: z.custom<PropAnalysisRequest>() });

/** node 1 — validate + normalize the analysis request. */
const resolveRequestNode = defineNode({
  id: "resolveRequest",
  description: "Validate the player-prop analysis request.",
  inputSchema,
  outputSchema: z.object({ request: z.custom<PropAnalysisRequest>() }),
  selectInput: (i) => inputSchema.parse(i.input),
  run: async (input) => {
    const parsed = requestSchema.safeParse(input.request);
    if (!parsed.success) return err(validationError(parsed.error.message));
    return ok({ request: parsed.data as PropAnalysisRequest });
  },
});

/** node 2 (terminal) — assemble the view model by reusing the analysis engines. */
const assembleNode = defineNode({
  id: "assembleAnalysis",
  description: "Assemble the PlayerPropAnalysisViewModel (reuses runAnalysis + scientific engines).",
  inputSchema: z.object({ request: z.custom<PropAnalysisRequest>() }),
  outputSchema: z.custom<PlayerPropAnalysisViewModel>(),
  dependsOn: ["resolveRequest"],
  costCategory: "io",
  timeoutMs: 30_000,
  selectInput: (i) => (i.resolveRequest as { request: PropAnalysisRequest }),
  run: async (input) => {
    const vm = await assemblePropAnalysis(input.request);
    return ok(vm);
  },
});

export function buildPropAnalysisV2Workflow(): Workflow {
  return {
    id: PLAYER_PROP_ANALYSIS_V2_ID,
    output: "assembleAnalysis",
    nodes: [resolveRequestNode, assembleNode],
  };
}

export interface PropAnalysisV2Run {
  result: Result<PlayerPropAnalysisViewModel>;
  trace: WorkflowTrace;
}

export async function runPropAnalysisV2(
  request: PropAnalysisRequest,
  options: Omit<RunOptions, "initialInputs"> = {},
): Promise<PropAnalysisV2Run> {
  const workflow = buildPropAnalysisV2Workflow();
  const { result, trace } = await runWorkflow<PlayerPropAnalysisViewModel>(workflow, {
    ...options,
    initialInputs: { input: { request } },
  });
  return { result, trace };
}
