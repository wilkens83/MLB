/* prizepicks-opportunity@1 assembly + run entry. Gathers facts via injected
   providers, runs the Opportunity Engine at the terminal node, and returns the
   canonical assessment + full trace. Reuses the graph executor unchanged. */

import { runWorkflow, type Workflow, type RunOptions } from "../graph/executor";
import type { Result } from "../graph/result";
import type { WorkflowTrace } from "@/schemas/workflow";
import type { CanonicalLineSnapshot } from "@/lib/prizepicks/ingestion/snapshot";
import type { CanonicalOpportunityAssessment } from "@/lib/prizepicks/opportunity/types";
import {
  resolveLineNode, loadPregameSnapshotNode, projectionNode, independentBaselineNode,
  calibrationNode, uncertaintyNode, sensitivityNode, fragilityNode,
  trustedScientificFactsNode, vetoesNode, opportunityDecisionNode,
} from "./nodes";
import { opportunityInputSchema, type OpportunityDeps } from "./types";

export const PRIZEPICKS_OPPORTUNITY_WORKFLOW_ID = "prizepicks-opportunity@1";

export function buildOpportunityWorkflow(deps: OpportunityDeps): Workflow {
  return {
    id: PRIZEPICKS_OPPORTUNITY_WORKFLOW_ID,
    output: "opportunityDecision",
    nodes: [
      resolveLineNode,
      loadPregameSnapshotNode(deps),
      projectionNode(deps),
      independentBaselineNode,
      trustedScientificFactsNode(deps),
      calibrationNode(deps),
      uncertaintyNode,
      sensitivityNode(deps),
      fragilityNode,
      vetoesNode,
      opportunityDecisionNode(deps),
    ],
  };
}

export interface OpportunityRun {
  result: Result<CanonicalOpportunityAssessment>;
  trace: WorkflowTrace;
}

export async function runOpportunityWorkflow(
  line: CanonicalLineSnapshot,
  deps: OpportunityDeps,
  options: Omit<RunOptions, "initialInputs"> = {},
): Promise<OpportunityRun> {
  const input = opportunityInputSchema.parse({ line });
  const workflow = buildOpportunityWorkflow(deps);
  const { result, trace } = await runWorkflow<CanonicalOpportunityAssessment>(workflow, {
    ...options,
    initialInputs: { input },
  });
  return { result, trace };
}
