# Graph Workflows

A workflow is a directed acyclic graph of typed **nodes**. The executor runs nodes
respecting `dependencies`, fanning out independent nodes in parallel (bounded),
fanning in at dependents, applying per-node timeout / retry / failure policy, and
collecting a trace. Node functions return a typed `Result<T>` — errors are values,
not thrown across boundaries.

## Node contract (`src/workflows/graph/types.ts`)

```
GraphNode<I, O> = {
  id: string
  description: string
  inputSchema: ZodType<I>
  outputSchema: ZodType<O>
  dependsOn: string[]
  timeoutMs: number
  retry: { maxAttempts; backoffMs; factor }
  failurePolicy: "fail-fast" | "retry" | "skip-with-warning" | "fallback" | "degrade" | "escalate"
  costCategory: "cpu" | "io" | "simulation" | "external-api"
  run(input, ctx): Promise<Result<O>>
  fallback?(ctx): Result<O>       // for failurePolicy "fallback"/"degrade"
  metadata?: Record<string, unknown>
}
```

## Executor guarantees (`executor.ts`)

- **Ordering**: topological; a node runs only after all `dependsOn` succeed (or are
  degraded to an allowed value).
- **Fan-out**: nodes with no unmet dependency run concurrently, capped by
  `budget.maxConcurrency`.
- **Fan-in**: a dependent receives its inputs assembled from named upstream outputs.
- **Conditional routing**: an edge may carry a predicate; a node is skipped when its
  guard is false (recorded as `skipped`, not failed).
- **Retry**: `failurePolicy: "retry"` retries up to `maxAttempts` with exponential
  backoff (`backoffMs * factor^n`).
- **Timeout**: each attempt races `timeoutMs`; a timeout is a `TimeoutError` Result.
- **Failure policy**: `fail-fast` aborts the run; `skip-with-warning` continues and
  records a warning; `fallback`/`degrade` substitute `fallback()`; `escalate`
  surfaces to the caller.
- **Budget**: total wall-clock, node count, and external-API call caps; exceeding
  any yields `BudgetExceededError` and stops scheduling new work.
- **Cancellation**: an `AbortSignal` stops scheduling and marks in-flight nodes
  `cancelled`.
- **Determinism**: given the same inputs and injected (seeded) adapters, a run
  produces the same outputs and the same node status set. Timing fields are the
  only non-deterministic part of the trace.
- **Trace**: every node yields `{ id, status, attempts, startedAt, completedAt,
  durationMs, warnings, errorCode?, cost }`; the run yields
  `{ workflowId, executionId, status, nodes[], warnings[], startedAt, completedAt }`.

## Implemented workflows

### A. Player prop (implemented in this migration)

```
loadGameLog ─▶ extractSeries ─▶ validateSampleQuality ─┐
                                                        ├─▶ project ─▶ simulate ─▶ comparePrice ─▶ verify ─▶ recommend
(injected adapters: getGameLog, prop catalog, price inputs)
```
- `validateSampleQuality` gates on minimum games; too few → `insufficient-data`
  status (workflow ends cleanly, no recommendation).
- `verify` is the independent verification sub-graph (bounds, sim stability,
  cross-method agreement, odds math, freshness).
- `comparePrice` degrades: no market price → model probability only, no EV.

### B–E. Slate, game-analysis, backtest, revalidation

Documented node shapes (see mission Phase 4). These reuse the same engine and are
the recommended next workflows to migrate; their node graphs are specified in
`docs/WORKFLOWS.md`.
