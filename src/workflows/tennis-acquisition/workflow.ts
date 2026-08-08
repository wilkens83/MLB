/* Tennis data-acquisition workflow assembly + run entry. Builds one fetch node
   per configured provider (fan-out), reconciles (fan-in), independently verifies,
   and returns the typed result + full execution trace. Reuses the graph executor
   and the canonical Tennis provider layer unchanged. */

import { runWorkflow, type Workflow, type RunOptions } from "../graph/executor";
import type { Result } from "../graph/result";
import type { WorkflowTrace } from "@/schemas/workflow";
import {
  providerHealthNode, selectProvidersNode, providerFetchNode,
  reconcileNode, independentVerifyNode, finalResultNode,
} from "./nodes";
import {
  tennisAcquisitionInputSchema, type AcquisitionResult,
  type TennisAcquisitionDeps, type TennisAcquisitionInput,
} from "./types";

export const TENNIS_ACQUISITION_WORKFLOW_ID = "tennis-data-acquisition@1";

export function buildTennisAcquisitionWorkflow(deps: TennisAcquisitionDeps): Workflow {
  const names = deps.providers.map((p) => p.name);
  return {
    id: TENNIS_ACQUISITION_WORKFLOW_ID,
    output: "finalResult",
    nodes: [
      providerHealthNode(deps.providers),
      selectProvidersNode(deps.providers),
      ...deps.providers.map((p) => providerFetchNode(p)),
      reconcileNode(names),
      independentVerifyNode,
      finalResultNode,
    ],
  };
}

export interface TennisAcquisitionRun {
  result: Result<AcquisitionResult>;
  trace: WorkflowTrace;
}

export async function runTennisAcquisitionWorkflow(
  rawInput: TennisAcquisitionInput,
  deps: TennisAcquisitionDeps,
  options: Omit<RunOptions, "initialInputs"> = {},
): Promise<TennisAcquisitionRun> {
  const input = tennisAcquisitionInputSchema.parse(rawInput);
  const workflow = buildTennisAcquisitionWorkflow(deps);
  const { result, trace } = await runWorkflow<AcquisitionResult>(workflow, {
    ...options,
    initialInputs: { input },
  });
  return { result, trace };
}
