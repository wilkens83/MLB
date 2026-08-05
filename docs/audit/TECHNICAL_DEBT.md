# Technical Debt — Audit (Phase 1)

Grouped by the categories in the mission brief. Severity: **H**igh / **M**edium /
**L**ow. "Status" is what the graph migration addresses now vs. later.

## Structure & maintainability

| # | Item | Sev | Status |
| --- | --- | --- | --- |
| 1 | `lib/mlb/analysis.ts` is a monolithic async orchestrator with mixed responsibilities (fetch, resolve, adjust, simulate, quality-score, assemble). No typed step boundaries. | H | Migrating to a graph workflow. |
| 2 | Parallel work is ad-hoc `Promise.all`; no fan-in contract, budget, or cancellation. | H | Graph executor. |
| 3 | Flat `src/lib` with 133 files; core / data / workflow concerns interleaved. | M | Documented target tree; incremental (no big-bang rename). |
| 4 | Broad barrel `index.ts` files are latent cycle risks. | L | Rule added in AGENTS.md. |

## Data access & validation

| 5 | MLB analysis payload crosses the route boundary **typed-only** (no Zod parse). | H | Contracts + verification nodes. |
| 6 | Orchestrator imports concrete adapters (`providers/statcast`, `providers/park`) — no repository interface seam. | M | Interface documented; workflow nodes depend on injected fns. |

## Reliability & error handling

| 7 | A failing **optional** context source can throw and destroy the whole analysis (no skip-with-warning / degrade policy). | H | Node failure policies. |
| 8 | Route error envelopes inconsistent (`{error}` vs `{error,detail}`); the analysis 502 path leaks `err.message`. | M | Shared response envelope (documented; applied to the new route path). |
| 9 | Retry/backoff exists in `mlb/client.ts` but is not policy-driven per call site; no per-step timeout. | M | Node retry/timeout policy. |
| 10 | No cancellation / abort propagation across the analysis. | M | Executor supports `AbortSignal` + budget. |

## Statistical integrity

| 11 | Empirical/analytic probability **blend** is reasonable but has **no calibration evidence** surfaced at the API boundary. | H | Backtest metrics exist (`lib/backtest`); EVALUATION_STRATEGY documents wiring; verification node bounds outputs. |
| 12 | Sample-quality thresholds live inside the projection; not an independent gate. | M | `SampleQualityVerifier` node. |
| 13 | Simulation stability / convergence is not checked before a recommendation is emitted. | M | `SimulationStabilityVerifier` node. |
| 14 | Cross-method agreement (empirical vs analytic) not asserted. | M | `CrossMethodAgreementVerifier` node. |
| 15 | No probability-bounds guard at the boundary (NaN/Inf/out-of-[0,1] could pass). | H | `ProbabilityBoundsVerifier` node + Zod refinement. |

## Testing & observability

| 16 | Single flat `test` script; no unit/contract/workflow/statistical separation. | M | Test scripts added. |
| 17 | No per-execution workflow trace (execution id, node timings, retries, cache status, warnings). | H | `observability/` + graph trace. |
| 18 | No leakage-prevention test named/enforced for backtests (guard exists in code). | M | Contract/statistical test coverage. |

## Performance

| 19 | Monte Carlo runs on the request path every call; no memoization of identical (player,prop,line) inputs beyond upstream cache. | M | Documented; deterministic seed already enables safe caching (future). |
| 20 | Some sequential awaits in orchestration could be parallel fan-out. | L | Graph fan-out. |

## Security

| 21 | Analysis 502 returns `err.message` to the client. | M | Shared envelope hides internals. |
| 22 | No central environment validation module (Supabase env handled locally). | L | Documented; `env` schema recommended. |
| 23 | Monte Carlo iteration counts are constants today, but any user-influenced count must be bounded. | L | Budget + schema bounds. |

## Accessibility

| 24 | Charts lack text/aria summaries; loading/empty/error/insufficient-data states are inconsistent across dashboards. | M | Documented in TARGET; frontend phase (later). |

## Not debt (explicitly preserve)

- Pure analytics core, prop→family registry, resolved season, `undefined`≠0,
  seeded RNG, append-only decision persistence, provider health registry.
