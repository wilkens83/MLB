/* Graph node contract + supporting types. Pure (zod + local modules only). */

import type { ZodType } from "zod";
import type { Result } from "./result";
import type { CostCategory } from "@/schemas/workflow";

export type FailurePolicy =
  | "fail-fast"
  | "retry"
  | "skip-with-warning"
  | "fallback"
  | "degrade"
  | "escalate";

export interface RetryPolicy {
  maxAttempts: number;
  backoffMs: number;
  factor: number;
}

export const NO_RETRY: RetryPolicy = { maxAttempts: 1, backoffMs: 0, factor: 1 };

/** Execution context handed to every node. */
export interface NodeContext {
  executionId: string;
  signal?: AbortSignal;
  /** Named outputs of already-completed upstream nodes. */
  inputs: Readonly<Record<string, unknown>>;
  /** Structured logging sink (no secrets). */
  log: (msg: string, fields?: Record<string, unknown>) => void;
  /** Per-node counters the node may bump (apiCalls, simulationCount). */
  meter: {
    apiCall: (n?: number) => void;
    simulations: (n: number) => void;
    cache: (status: "hit" | "miss" | "stale" | "bypass") => void;
  };
}

export interface GraphNode<I = unknown, O = unknown> {
  id: string;
  description: string;
  inputSchema: ZodType<I>;
  outputSchema: ZodType<O>;
  /** Ids of nodes that must complete before this one runs. */
  dependsOn: string[];
  timeoutMs: number;
  retry: RetryPolicy;
  failurePolicy: FailurePolicy;
  costCategory: CostCategory;
  /** Build this node's typed input from the completed upstream outputs. */
  selectInput: (inputs: Readonly<Record<string, unknown>>) => I;
  run: (input: I, ctx: NodeContext) => Promise<Result<O>>;
  /** Substitute value for fallback/degrade policies. */
  fallback?: (ctx: NodeContext) => Result<O>;
  /** Optional guard — when it returns false the node is skipped (conditional routing). */
  guard?: (inputs: Readonly<Record<string, unknown>>) => boolean;
  metadata?: Record<string, unknown>;
}

export interface ExecutionBudget {
  maxWallClockMs: number;
  maxNodes: number;
  maxExternalApiCalls: number;
  maxConcurrency: number;
}

export const DEFAULT_BUDGET: ExecutionBudget = {
  maxWallClockMs: 30_000,
  maxNodes: 64,
  maxExternalApiCalls: 128,
  maxConcurrency: 8,
};
