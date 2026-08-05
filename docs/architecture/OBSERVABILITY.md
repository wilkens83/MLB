# Observability

## Structured logging (`src/observability/logger.ts`)

A tiny, dependency-free structured logger. Emits JSON lines
`{ level, msg, ts, ...fields }`. Levels: `debug|info|warn|error`. In production the
default level is `info`; `debug` is opt-in via `LOG_LEVEL`. **Never logs secrets**
(service-role keys, tokens) or full user payloads — only ids, codes, counts, and
timings.

## Workflow trace (`src/observability/trace.ts` + `graph/trace.ts`)

Every workflow execution produces a `WorkflowTrace`:

```
{
  workflowId, executionId, status,
  gameId?, playerId?, marketId?,
  startedAt, completedAt, durationMs,
  nodes: [{ id, status, attempts, startedAt, completedAt, durationMs,
            warnings, errorCode?, cost, cacheStatus?, apiCalls?, simulationCount? }],
  warnings[]
}
```

- `executionId` is a per-run UUID; `workflowId` names the workflow.
- Node `cost` is the declared `costCategory`; `apiCalls`/`simulationCount` are
  counters incremented by adapters/nodes.
- `cacheStatus` ∈ {hit, miss, stale, bypass} where the upstream cache reports it.

## Debug trace endpoint

`GET /api/debug/trace?...` returns the last workflow trace as JSON. It is
**disabled in production** unless `ENABLE_DEBUG_TRACE=1`, and returns 404 otherwise,
so traces are never exposed by default. Traces contain no secrets or PII.

## What is measured

Per node: duration, retry count, status, warnings, error code, cache status, API
call count, simulation count. Per run: total duration, node count, terminal status,
aggregated warnings. These feed latency/failure dashboards and make degraded
results explainable to the user (the envelope surfaces `warnings`).
