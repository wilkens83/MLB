# Feature Inventory (as of `origin/main` @ 6cdcd9f)

Since `main` is a strict superset of every remote branch (see
`MAIN_CONSOLIDATION_AUDIT.md`), "present on main" ≡ "present anywhere in the
repository". This inventory is the source of truth for what exists versus what
was never built.

## Present and consolidated on `main`

| Subsystem | Location | Status |
|---|---|---|
| MLB Stats API client (timeout, retry, dedup, bounded TTL cache, Zod) | `src/lib/mlb/client.ts` | ✅ |
| Dynamic MLB season resolver | `src/lib/mlb/season.ts` | ✅ |
| Schedules / games / teams / players / rosters / splits / game logs | `src/lib/mlb/api.ts` | ✅ |
| Projected lineups (labeled projected, never confirmed) | `src/lib/mlb/api.ts`, `slate.ts` | ✅ |
| Baseball Savant / Statcast + pitch arsenal | `src/lib/providers/{statcast,arsenal,savantClient}.ts` | ✅ |
| Projection engine (recency + shrinkage + context) | `src/lib/prediction/projection.ts` | ✅ |
| Monte Carlo + plate-appearance simulation | `src/lib/prediction/{simulate,paSim}.ts` | ✅ |
| More / Less / Push, confidence, data quality | `src/lib/prediction/{simulate,quality}.ts` | ✅ |
| Prop Explorer / slate / market cards | `src/app/analyze`, `src/lib/mlb/{slate,market}.ts` | ✅ |
| PrizePicks Board (manual + CSV import, MLBAM resolver, market map, evaluate, ranking) | `src/lib/prizepicks/*`, `/prizepicks-board` | ✅ |
| Line-history + immutable pregame snapshots | `src/lib/prizepicks/store.ts` (`lockPregameSnapshot`) | ✅ |
| Result grading | `src/lib/prizepicks/grading.ts` | ✅ |
| AI Data Chat (typed tools, mock + anthropic providers) | `src/features/chat/*`, `/chat` | ✅ |
| Tennis vertical (fixtures/manual/CSV; not live) | `src/lib/tennis/*`, `/tennis` | ✅ |
| Data Health | `src/lib/providers/health.ts`, `/health` | ✅ |
| CI (lint/tsc/test/build; live-data isolated) | `.github/workflows/ci.yml` | ✅ |

## Added by this consolidation PR (absent from the entire repository before)

| Subsystem | Location | Status |
|---|---|---|
| Correlation-aware **entry analysis** (joint sim → pairwise correlation, contradiction detection, Flex/Power outcome distribution + payout EV) | `src/lib/prizepicks/entry/*` | ✅ new, unit-tested |
| **Backtesting** metrics engine (Brier, log-loss, calibration buckets, hit-rate, MAE/RMSE, by-market/bucket) over pregame snapshots + graded results | `src/lib/backtest/*` | ✅ new, unit-tested |
| Chat tools surfacing entry analysis + backtest metrics | `src/features/chat/tools/*` | ✅ new |

## Added by the PrizePicks economics rebuild

| Subsystem | Location | Status |
|---|---|---|
| Versioned, configurable payout tables (Power/Flex, refunds, effective dates, source) | `src/lib/prizepicks/entry/payout.ts` | ✅ new, tested |
| Complete-entry economics (expected return/profit, downside, "Payout configuration required") | `entry/payout.ts` + `entry/entry.ts` | ✅ new, tested |
| Independence-approximation path (Poisson-binomial, explicitly labeled) | `entry/independence.ts` | ✅ new, tested |
| Projection assessment policy (REVIEW/WAIT/AVOID/NO_EDGE/UNAVAILABLE) | `src/lib/prizepicks/assessment.ts` | ✅ new, tested |
| Sportsbook-free regression guard for the PrizePicks path | `src/lib/prizepicks/no-sportsbook.test.ts` | ✅ new |

## Known limitations (genuinely unbuilt — documented, not stubbed)

These were never implemented on any branch. They are **not** "distributed
functionality pending consolidation" — there is nothing to integrate. Building
each to a verified, tested standard is a separate initiative; shipping
unverified stubs would violate the "never merge broken code / never fabricate"
rules.

- **Dedicated point-in-time player-profile engine** (the full Phase-5 metric set
  as a standalone module). Today the equivalent data is computed inside
  `runAnalysis` + the Statcast panels rather than a separate profile builder.
- **Model-performance dashboards / UI** for backtesting. The metrics **engine**
  ships and is tested; a dedicated dashboard page is not built (metrics are
  exposed via a chat tool and are API-ready).
- **Persistent database (Supabase/Postgres) + migrations.** Persistence is
  server-side in-memory (chat) / localStorage (PrizePicks board), with
  DB-shaped interfaces ready for an adapter. No migration layer exists yet.
- **Cross-entity (pitcher ↔ opposing hitters) correlation.** The entry engine
  correlates same-player/same-game legs through a shared simulation; different
  players are simulated independently (documented in the engine).
- **Reviewed-image PrizePicks import.** Only manual + CSV import exist.
- **Earned-runs run-scoring** in the pitcher joint sim uses a standard simplified
  bases-state advancement model (all-earned, no DP/steals) — documented as an
  approximation, not a fabrication.
