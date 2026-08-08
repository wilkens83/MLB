/* followed-player-performance@1 assembly + run entry. Fans out over a user's
   followed players (bounded concurrency), computes each one's HISTORICAL
   performance, and returns the My Players dashboard + full trace. Reuses the
   graph executor unchanged. Computes NO model probabilities. */

import { runWorkflow, type Workflow, type RunOptions } from "../graph/executor";
import type { Result } from "../graph/result";
import type { WorkflowTrace } from "@/schemas/workflow";
import {
  resolveFollowedNode,
  computePerformanceNode,
  assembleDashboardNode,
} from "./nodes";
import {
  followedPerformanceInputSchema,
  type FollowedPerformanceDeps,
  type FollowedPlayerRequest,
  type FollowedPlayersDashboard,
} from "./types";

export const FOLLOWED_PLAYER_PERFORMANCE_WORKFLOW_ID = "followed-player-performance@1";

export function buildFollowedPerformanceWorkflow(deps: FollowedPerformanceDeps): Workflow {
  return {
    id: FOLLOWED_PLAYER_PERFORMANCE_WORKFLOW_ID,
    output: "assembleDashboard",
    nodes: [
      resolveFollowedNode,
      computePerformanceNode(deps),
      assembleDashboardNode(deps),
    ],
  };
}

export interface FollowedPerformanceRun {
  result: Result<FollowedPlayersDashboard>;
  trace: WorkflowTrace;
}

export async function runFollowedPerformanceWorkflow(
  players: FollowedPlayerRequest[],
  deps: FollowedPerformanceDeps,
  opts: { concurrency?: number } & Omit<RunOptions, "initialInputs"> = {},
): Promise<FollowedPerformanceRun> {
  const { concurrency, ...runOptions } = opts;
  const input = followedPerformanceInputSchema.parse({ players, concurrency });
  const workflow = buildFollowedPerformanceWorkflow(deps);
  const { result, trace } = await runWorkflow<FollowedPlayersDashboard>(workflow, {
    ...runOptions,
    initialInputs: { input },
  });
  return { result, trace };
}
