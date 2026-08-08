/* prizepicks-import@1 assembly + run entry. Reuses the graph executor and the
   existing PrizePicks resolver/parser via injected deps (default = the real MLB
   resolver + the configured snapshot store; injectable for offline tests). */

import { runWorkflow, type Workflow, type RunOptions } from "../graph/executor";
import type { Result } from "../graph/result";
import type { WorkflowTrace } from "@/schemas/workflow";
import { resolvePlayer, resolveGame } from "@/lib/prizepicks/player-resolver";
import { getLineSnapshotStore } from "@/lib/prizepicks/ingestion/snapshotStore";
import {
  loadInputNode, parseRowsNode, normalizeMarketsNode, resolvePlayersNode,
  resolveGamesNode, validateNode, reviewGateNode, persistSnapshotsNode,
} from "./nodes";
import { importInputSchema, type ImportDeps, type ImportInput, type ImportResult } from "./types";

export const PRIZEPICKS_IMPORT_WORKFLOW_ID = "prizepicks-import@1";

export function defaultImportDeps(): ImportDeps {
  return { resolvePlayer, resolveGame, store: getLineSnapshotStore() };
}

export function buildPrizePicksImportWorkflow(deps: ImportDeps, sourceReference?: string): Workflow {
  return {
    id: PRIZEPICKS_IMPORT_WORKFLOW_ID,
    output: "persistSnapshots",
    nodes: [
      loadInputNode,
      parseRowsNode,
      normalizeMarketsNode,
      resolvePlayersNode(deps),
      resolveGamesNode(deps),
      validateNode(sourceReference),
      reviewGateNode,
      persistSnapshotsNode(deps),
    ],
  };
}

export interface PrizePicksImportRun {
  result: Result<ImportResult>;
  trace: WorkflowTrace;
}

export async function runPrizePicksImportWorkflow(
  rawInput: ImportInput,
  deps: ImportDeps = defaultImportDeps(),
  options: Omit<RunOptions, "initialInputs"> = {},
): Promise<PrizePicksImportRun> {
  const input = importInputSchema.parse(rawInput);
  const workflow = buildPrizePicksImportWorkflow(deps, input.sourceReference);
  const { result, trace } = await runWorkflow<ImportResult>(workflow, {
    ...options,
    initialInputs: { input },
  });
  return { result, trace };
}
