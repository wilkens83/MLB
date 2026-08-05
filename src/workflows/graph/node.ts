/* Node definition helper + edge/state re-exports. `defineNode` supplies safe
   defaults (no retry, cpu cost, fail-fast) so a node only declares what differs.
   Pure. */

import type { GraphNode, RetryPolicy } from "./types";
import { NO_RETRY } from "./types";

export function defineNode<I, O>(spec: {
  id: string;
  description: string;
  inputSchema: GraphNode<I, O>["inputSchema"];
  outputSchema: GraphNode<I, O>["outputSchema"];
  dependsOn?: string[];
  timeoutMs?: number;
  retry?: RetryPolicy;
  failurePolicy?: GraphNode<I, O>["failurePolicy"];
  costCategory?: GraphNode<I, O>["costCategory"];
  selectInput: GraphNode<I, O>["selectInput"];
  run: GraphNode<I, O>["run"];
  fallback?: GraphNode<I, O>["fallback"];
  guard?: GraphNode<I, O>["guard"];
  metadata?: Record<string, unknown>;
}): GraphNode<I, O> {
  return {
    id: spec.id,
    description: spec.description,
    inputSchema: spec.inputSchema,
    outputSchema: spec.outputSchema,
    dependsOn: spec.dependsOn ?? [],
    timeoutMs: spec.timeoutMs ?? 10_000,
    retry: spec.retry ?? NO_RETRY,
    failurePolicy: spec.failurePolicy ?? "fail-fast",
    costCategory: spec.costCategory ?? "cpu",
    selectInput: spec.selectInput,
    run: spec.run,
    fallback: spec.fallback,
    guard: spec.guard,
    metadata: spec.metadata,
  };
}
