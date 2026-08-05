# Testing

Unit tests are colocated `*.test.ts` and run under **Bun** (deterministic,
offline). Live-data scripts run under Node/tsx and are kept off the PR gate.

## Commands

| Script | Scope |
| --- | --- |
| `pnpm test:all` | whole suite (`bun test src`) |
| `pnpm test:unit` | pure core + libs (odds, math, projection, simulation, decision) |
| `pnpm test:contracts` | Zod contract acceptance + rejection (`src/schemas`) |
| `pnpm test:workflows` | graph engine + workflows (`src/workflows`) |
| `pnpm test:statistical` | calibration, distributions, RNG, leakage (`backtest`, `math`, `prediction`) |
| `pnpm typecheck` | `tsc --noEmit` |
| `pnpm verify` | lint + typecheck + tests + build |

## What is covered

- **Graph engine**: ordering, fan-out/fan-in, conditional routing (guards), retry
  with backoff, timeout, budget stop, cancellation, failure policies
  (skip-with-warning, fallback/degrade), and input/output schema enforcement.
- **Contracts**: probability bounds, over/under/push sum, recommendation status,
  MLBAM-id requirement, american-odds boundary, trace shape.
- **Verification**: each independent verifier (bounds, sample quality, projection
  sanity, simulation stability, cross-method agreement, odds math, freshness,
  recommendation, completeness).
- **Player-prop workflow**: happy path, no-price degrade, insufficient-data,
  leakage → rejected, determinism (same seed → same output), adapter failure →
  typed `DataUnavailableError` (not a throw), full trace.

## Rules

- Fixtures for external MLB responses; unit/contract/workflow suites never depend
  on live network.
- Cover happy, degraded, and rejected paths.
- A test fails before the fix, passes after; never weaken an assertion to go green.
- Backtests are time-aware — a leakage test guards against future-data usage.
