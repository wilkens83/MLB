# Error Handling & Failure Policies

## Error taxonomy (`src/workflows/graph/errors.ts`)

`ValidationError`, `ExternalApiError`, `TimeoutError`, `RateLimitError`,
`DataUnavailableError`, `ModelError`, `SimulationError`, `VerificationError`,
`BudgetExceededError`, `CancelledError`. Each carries a stable `code`, a
human-readable `message`, and a `retryable` boolean.

## Result, not throw

Node functions return `Result<T> = Ok<T> | Err<WorkflowError>`. Errors are values
that flow into the trace. The executor only throws for programmer errors (a node
referencing a missing dependency), never for expected runtime failures.

## Per-node failure policies

| Policy | Behavior |
| --- | --- |
| `fail-fast` | Abort the run; propagate the error as the workflow result. |
| `retry` | Retry up to `maxAttempts` with exponential backoff, then apply the fallback policy or fail. |
| `skip-with-warning` | Record a warning, continue; dependents receive `undefined` for this input. |
| `fallback` | Substitute `node.fallback(ctx)` and continue. |
| `degrade` | Like fallback, but marks the whole result `degraded` and adds a user-facing warning. |
| `escalate` | Surface immediately to the caller for a decision. |

## Concrete policies for the player-prop workflow

| Node | Missing/failed → policy | Result |
| --- | --- | --- |
| `loadGameLog` | MLB API down → `retry` then `fail-fast` | explicit `DataUnavailableError`, degraded result envelope |
| `extractSeries` | prop unsupported → `fail-fast` | `ValidationError` (unsupported market) |
| `validateSampleQuality` | too few games → terminal `insufficient-data` | clean stop, no recommendation |
| `weatherContext` (game-analysis) | unavailable → `degrade` | neutral context + warning |
| `probablePitcher` (game-analysis) | unavailable → reject pitcher markets | pitcher markets `rejected` |
| `comparePrice` | no market price → `skip-with-warning` | model probability only, **no EV** |
| `simulate` | unstable → `VerificationError` from stability verifier | `rejected`, no recommendation |

## HTTP mapping (shared envelope)

Success: `{ data, meta:{ requestId, generatedAt, dataFreshness, warnings[] }, error:null }`.
Failure: `{ data:null, meta:{ requestId, generatedAt }, error:{ code, message, retryable } }`.
Never leak stack traces or internal messages. 4xx for validation/insufficient
input; 502/503 for external/degraded; 500 only for unexpected programmer errors
(generic message).
