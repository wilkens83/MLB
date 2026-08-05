/* Player-prop workflow assembly + run entry. Injects the data adapter, validates
   the request, runs the graph, and returns the typed recommendation + trace. */

import { runWorkflow, type Workflow, type RunOptions } from "../graph/executor";
import type { Result } from "../graph/result";
import type { WorkflowTrace } from "@/schemas/workflow";
import type { Recommendation } from "@/schemas/analysis";
import {
  loadSeriesNode, sampleQualityNode, projectNode, simulateNode,
  priceCompareNode, verifyNode, recommendNode,
} from "./nodes";
import { playerPropInputSchema, type PlayerPropDeps, type PlayerPropInput } from "./types";

export const PLAYER_PROP_WORKFLOW_ID = "player-prop@1";

export function buildPlayerPropWorkflow(deps: PlayerPropDeps): Workflow {
  return {
    id: PLAYER_PROP_WORKFLOW_ID,
    output: "recommend",
    nodes: [
      loadSeriesNode(deps),
      sampleQualityNode,
      projectNode,
      simulateNode,
      priceCompareNode,
      verifyNode,
      recommendNode,
    ],
  };
}

export interface PlayerPropRun {
  result: Result<Recommendation>;
  trace: WorkflowTrace;
}

export async function runPlayerPropWorkflow(
  rawInput: PlayerPropInput,
  deps: PlayerPropDeps,
  options: Omit<RunOptions, "initialInputs" | "subject"> = {},
): Promise<PlayerPropRun> {
  const input = playerPropInputSchema.parse(rawInput);
  const workflow = buildPlayerPropWorkflow(deps);
  const { result, trace } = await runWorkflow<Recommendation>(workflow, {
    ...options,
    initialInputs: { input },
    subject: { playerId: input.playerId, marketId: input.propKey },
  });
  return { result, trace };
}
