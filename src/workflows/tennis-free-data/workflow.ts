/* Free-dataset acquisition workflow assembly + run entry. Reuses the graph
   executor and the free dataset builder; the source loader is injected (default =
   bundled seed) so no network is touched at build/test time. */

import { runWorkflow, type Workflow, type RunOptions } from "../graph/executor";
import type { Result } from "../graph/result";
import type { WorkflowTrace } from "@/schemas/workflow";
import { getFreeDataset } from "@/lib/tennis/data/freeDataset";
import {
  datasetMetadataNode, loadSourceNode, normalizeNode, resolveIdentitiesNode,
  verifyCanonicalNode, persistNode, healthReportNode,
} from "./nodes";
import { freeDataInputSchema, type FreeDataDeps, type FreeDataHealthReport, type FreeDataInput } from "./types";

export const TENNIS_FREE_DATA_WORKFLOW_ID = "tennis-free-data-acquisition@1";

const DEFAULT_DEPS: FreeDataDeps = { load: getFreeDataset };

export function buildFreeDataWorkflow(deps: FreeDataDeps = DEFAULT_DEPS): Workflow {
  return {
    id: TENNIS_FREE_DATA_WORKFLOW_ID,
    output: "healthReport",
    nodes: [
      datasetMetadataNode(deps),
      loadSourceNode(deps),
      normalizeNode(deps),
      resolveIdentitiesNode(deps),
      verifyCanonicalNode(deps),
      persistNode(deps),
      healthReportNode(deps),
    ],
  };
}

export interface FreeDataRun {
  result: Result<FreeDataHealthReport>;
  trace: WorkflowTrace;
}

export async function runFreeDataWorkflow(
  rawInput: FreeDataInput = {},
  deps: FreeDataDeps = DEFAULT_DEPS,
  options: Omit<RunOptions, "initialInputs"> = {},
): Promise<FreeDataRun> {
  const input = freeDataInputSchema.parse(rawInput);
  const workflow = buildFreeDataWorkflow(deps);
  const { result, trace } = await runWorkflow<FreeDataHealthReport>(workflow, {
    ...options,
    initialInputs: { input },
  });
  return { result, trace };
}
