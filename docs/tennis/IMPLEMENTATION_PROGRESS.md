# Tennis Integration — Implementation Progress

Living status log for adding Tennis as a fully integrated sport inside Diamond Edge.
Updated as each phase lands. MLB regression gate: **`bun test src` must stay green
(86 baseline MLB tests) at every commit.**

## Legend
- ✅ done & verified
- 🚧 in progress
- ⛔ blocked / deferred (with reason)
- ⬜ not started

## Scope of the current task: **Tennis data acquisition layer (Phases 0–5)**

| Phase | Deliverable | Status | Notes |
|---|---|---|---|
| 0 | Repository audit + this tracker | ✅ | `docs/tennis/REPOSITORY_AUDIT.md`. Honest infra-gap accounting. |
| 1 | Multi-sport core (`SportKey`, registry, `SportAdapter`) | ⬜ | Additive; MLB registered descriptively. |
| 2 | Tennis domain types | ⬜ | Player/Tournament/Match/MatchStats/RankingSnapshot + enums. |
| 3 | Tennis market catalog + Zod schemas | ⬜ | Markets → distribution families; boundary validation. |
| 4 | `TennisDataProvider` + adapters + fixtures | ⬜ | Sportradar/SportsDataIO/ApiTennis/HistoricalCsv/Manual — interface+fixtures+docs, no creds. |
| 5 | Acquisition orchestration + identity resolution + tests | ⬜ | Live/historical/projection over fixtures; never name-alone. |

## Deferred / out-of-scope for this task (scoped, not built yet)
| Phase | Deliverable | Status | Notes |
|---|---|---|---|
| 6 | Structural match simulation (point→game→set→match) | ⬜ | Feeds `summarizeSamples`. |
| 7 | Elo / surface-Elo | ⬜ | |
| 8 | Market models (winner, totals, sets, aces, handicap) | ⬜ | |
| 9 | Correlation + entry builder | ⬜ | |
| 10 | Frontend `/tennis/*` | ⬜ | |
| 11 | Backtesting + observability + docs | ⬜ | |

## Infrastructure reality (from audit §5)
- No DB → historical imports target an abstracted `HistoricalStore` (file-backed first).
- No job scheduler → acquisition exposed as idempotent scripts.
- No tennis credentials → every provider adapter is interface + fixtures + docs; inert without keys.
- No auth/CI → out of scope; documented, not fabricated.

## Compliance invariants (enforced every phase)
No account automation/login/credential storage · no CAPTCHA/anti-bot bypass · no
scraping protected pages · no fabricated/mock data in production paths (fixtures are
test-only, labeled) · every unavailable metric returns explicit *unavailable* · never
join players by name alone · provider keys server-side only · CSV rejects
formula-injection · never call an unverified provider "production-verified".

## Change log
- 2026-07-23 — Phase 0 complete: audit + progress tracker committed.
