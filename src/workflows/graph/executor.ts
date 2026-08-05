/* ============================================================================
   Graph executor. Runs a DAG of typed nodes: topological ordering, bounded
   parallel fan-out, fan-in, conditional routing (node guards), per-node timeout
   + retry with exponential backoff, per-node failure policy, execution budget,
   cancellation, and full trace collection. Node errors are values (Result); the
   executor throws only for malformed graphs (missing dependency).
   Pure aside from Date.now / setTimeout; dependency-free beyond schemas + local.
   ========================================================================== */

import { randomUUID } from "node:crypto";
import type { GraphNode, NodeContext, ExecutionBudget } from "./types";
import { DEFAULT_BUDGET } from "./types";
import { ExecutionState } from "./state";
import { BudgetTracker } from "./budget";
import { TraceCollector } from "./trace";
import { err, ok, type Result } from "./result";
import {
  budgetExceededError, cancelledError, timeoutError, validationError, type WorkflowError,
} from "./errors";
import type { WorkflowTrace, NodeStatus } from "@/schemas/workflow";
import { logger } from "@/observability/logger";

export interface Workflow {
  id: string;
  nodes: GraphNode[];
  /** Node id whose output is the workflow result. */
  output: string;
}

export interface RunOptions {
  initialInputs?: Record<string, unknown>;
  budget?: Partial<ExecutionBudget>;
  signal?: AbortSignal;
  subject?: { gameId?: number; playerId?: number; marketId?: string };
}

export interface RunResult<T = unknown> {
  result: Result<T>;
  trace: WorkflowTrace;
}

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

function withTimeout<T>(p: Promise<Result<T>>, ms: number, signal?: AbortSignal): Promise<Result<T>> {
  return new Promise((resolve) => {
    let done = false;
    const t = setTimeout(() => {
      if (!done) { done = true; resolve(err(timeoutError(`node exceeded ${ms}ms`))); }
    }, ms);
    const onAbort = () => { if (!done) { done = true; clearTimeout(t); resolve(err(cancelledError("aborted"))); } };
    signal?.addEventListener("abort", onAbort, { once: true });
    p.then((r) => {
      if (!done) { done = true; clearTimeout(t); signal?.removeEventListener("abort", onAbort); resolve(r); }
    }).catch((e) => {
      if (!done) { done = true; clearTimeout(t); resolve(err({ code: "INTERNAL", message: e instanceof Error ? e.message : String(e), retryable: false })); }
    });
  });
}

export async function runWorkflow<T = unknown>(
  workflow: Workflow,
  options: RunOptions = {},
): Promise<RunResult<T>> {
  const executionId = randomUUID();
  const budget = new BudgetTracker({ ...DEFAULT_BUDGET, ...options.budget });
  const trace = new TraceCollector(workflow.id, executionId, options.subject);
  const log = logger.child({ workflowId: workflow.id, executionId });

  const nodes = new Map(workflow.nodes.map((n) => [n.id, n]));
  // Validate the graph shape up-front (programmer error → throw, not a Result).
  for (const n of workflow.nodes) {
    for (const dep of n.dependsOn) {
      if (!nodes.has(dep) && !(options.initialInputs && dep in options.initialInputs)) {
        throw new Error(`node "${n.id}" depends on unknown "${dep}"`);
      }
    }
  }

  const state = new ExecutionState([...nodes.keys()], options.initialInputs ?? {});
  let degraded = false;
  let fatal: WorkflowError | null = null;

  const runNode = async (node: GraphNode): Promise<void> => {
    const nt = trace.startNode(node.id, node.costCategory);
    const inputsView = state.inputsView();

    // Conditional routing — a false guard skips the node (not a failure).
    if (node.guard && !node.guard(inputsView)) {
      nt.status = "skipped"; nt.completedAt = Date.now();
      state.status.set(node.id, "skipped");
      log.debug("node skipped by guard", { node: node.id });
      return;
    }

    const ctx: NodeContext = {
      executionId, signal: options.signal, inputs: inputsView,
      log: (msg, fields) => log.debug(msg, { node: node.id, ...fields }),
      meter: {
        apiCall: (n = 1) => { nt.apiCalls += n; budget.countApiCalls(n); },
        simulations: (n) => { nt.simulationCount += n; },
        cache: (status) => { nt.cacheStatus = status; },
      },
    };

    // Typed input selection + validation.
    let input: unknown;
    try {
      input = node.inputSchema.parse(node.selectInput(inputsView));
    } catch (e) {
      return finalizeError(node, nt, validationError(`input validation failed: ${e instanceof Error ? e.message : String(e)}`));
    }

    // Attempts with retry + timeout.
    let last: Result<unknown> = err({ code: "INTERNAL", message: "not run", retryable: false });
    for (let attempt = 1; attempt <= node.retry.maxAttempts; attempt++) {
      nt.attempts = attempt;
      budget.countNode();
      last = await withTimeout(node.run(input, ctx), node.timeoutMs, options.signal);
      if (last.ok) break;
      if (options.signal?.aborted) break;
      const canRetry = last.error.retryable && attempt < node.retry.maxAttempts;
      if (!canRetry) break;
      await sleep(node.retry.backoffMs * node.retry.factor ** (attempt - 1));
    }

    if (last.ok) {
      // Output validation.
      try {
        const out = node.outputSchema.parse(last.value);
        state.outputs.set(node.id, out);
        state.status.set(node.id, "ok");
        nt.status = "ok"; nt.completedAt = Date.now();
      } catch (e) {
        finalizeError(node, nt, validationError(`output validation failed: ${e instanceof Error ? e.message : String(e)}`));
      }
      return;
    }
    finalizeError(node, nt, last.error);
  };

  function finalizeError(
    node: GraphNode,
    nt: ReturnType<TraceCollector["startNode"]>,
    error: WorkflowError,
  ): void {
    nt.errorCode = error.code;
    nt.completedAt = Date.now();
    const statusFor = (): NodeStatus => (error.code === "TIMEOUT" ? "timeout" : error.code === "CANCELLED" ? "cancelled" : "failed");

    switch (node.failurePolicy) {
      case "skip-with-warning": {
        nt.status = "skipped";
        nt.warnings.push(`skipped: ${error.code} ${error.message}`);
        trace.addWarning(`${node.id}: ${error.code} ${error.message}`);
        state.status.set(node.id, "skipped");
        return;
      }
      case "fallback":
      case "degrade": {
        const fb = node.fallback?.(/* ctx not needed */ {} as NodeContext);
        if (fb && fb.ok) {
          state.outputs.set(node.id, fb.value);
          state.status.set(node.id, "degraded");
          nt.status = "degraded";
          nt.warnings.push(`fallback after ${error.code}`);
          if (node.failurePolicy === "degrade") { degraded = true; trace.addWarning(`${node.id} degraded: ${error.message}`); }
          return;
        }
        // No usable fallback → treat as failure.
        nt.status = statusFor();
        state.status.set(node.id, "failed");
        fatal = fatal ?? error;
        return;
      }
      case "escalate":
      case "retry":
      case "fail-fast":
      default: {
        nt.status = statusFor();
        state.status.set(node.id, nt.status);
        fatal = fatal ?? error;
        return;
      }
    }
  }

  // Round-based scheduler: each round runs all ready nodes up to the concurrency
  // cap (fan-out), then blocks (fan-in) before the next round.
  while (true) {
    if (options.signal?.aborted) { fatal = fatal ?? cancelledError("run aborted"); break; }
    const overBudget = budget.exceeded();
    if (overBudget) { fatal = budgetExceededError(overBudget); break; }
    if (fatal) break;

    const pending = [...nodes.values()].filter((n) => state.status.get(n.id) === "pending");
    if (pending.length === 0) break;

    // Cascade-skip nodes whose deps are terminal but not all usable.
    let progressed = false;
    const ready: GraphNode[] = [];
    for (const n of pending) {
      const depsTerminal = n.dependsOn.every((d) => nodes.has(d) ? state.terminal(d) : true);
      if (!depsTerminal) continue;
      const depsUsable = n.dependsOn.every((d) => nodes.has(d) ? state.usable(d) : true);
      if (depsUsable) { ready.push(n); }
      else {
        const nt = trace.startNode(n.id, n.costCategory);
        nt.status = "skipped"; nt.completedAt = Date.now();
        nt.warnings.push("skipped: upstream dependency not usable");
        trace.addWarning(`${n.id}: skipped (upstream not usable)`);
        state.status.set(n.id, "skipped");
        progressed = true;
      }
    }

    if (ready.length === 0) {
      if (progressed) continue; // made progress via cascade-skips
      break; // no runnable nodes and no progress — done
    }

    const batch = ready.slice(0, budget.maxConcurrency);
    for (const n of batch) state.status.set(n.id, "running");
    await Promise.all(batch.map(runNode));
  }

  // Determine terminal status + result.
  let status: WorkflowTrace["status"];
  let result: Result<T>;
  if (options.signal?.aborted) {
    status = "cancelled"; result = err(cancelledError("run aborted"));
  } else if (fatal?.code === "BUDGET_EXCEEDED") {
    status = "budget-exceeded"; result = err(fatal);
  } else if (fatal) {
    status = "failed"; result = err(fatal);
  } else if (state.usable(workflow.output)) {
    status = degraded ? "degraded" : "ok";
    result = ok(state.outputs.get(workflow.output) as T);
  } else {
    status = "failed";
    result = err(validationError(`output node "${workflow.output}" produced no usable value`));
  }

  const finalTrace = trace.finish(status);
  log.info("workflow finished", { status, nodes: finalTrace.nodes.length, durationMs: finalTrace.durationMs });
  return { result, trace: finalTrace };
}
