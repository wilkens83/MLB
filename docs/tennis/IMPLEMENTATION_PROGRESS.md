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
| 1 | Multi-sport core (`SportKey`, registry, `SportAdapter`) | ✅ | `src/lib/sports/`. MLB registered descriptively; tennis behind `enabled:false`. |
| 2 | Tennis domain types | ✅ | `src/lib/tennis/domain/` — Player/Tournament/Match/MatchStats/Ranking + enums + markets. |
| 3 | Tennis market catalog + Zod schemas | ✅ | `domain/markets.ts` + `schemas/tennis.ts`; markets → shared distribution families. |
| 4 | `TennisDataProvider` + adapters + fixtures | ✅ | Fixture / HistoricalCsv / Manual (real) + Sportradar/SportsDataIO/ApiTennis (inert, keyed) + registry failover + health. |
| 5 | Acquisition orchestration + identity resolution + tests | ✅ | `data/` — acquisition facade (live/historical/projection), identity (never name-alone), serve-hold derivation, `HistoricalStore`. 35 tennis+sports tests. |

**Acquisition layer (Phases 0–5) is COMPLETE and verified.** 121 tests pass (86 MLB
unchanged + 7 sports + 28 tennis). Lint clean. `tsc --noEmit` clean. Zero edits to
the protected computational core.

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
- 2026-07-23 — Phases 1–5 complete: multi-sport core, tennis domain + markets + Zod
  schemas, provider layer (fixture/CSV/manual + inert credentialed live + registry
  failover + health), acquisition orchestration, identity resolution, serve-hold
  derivation, `HistoricalStore`. 121 tests pass; lint + tsc clean; core untouched.
  `docs/tennis/PROVIDERS.md` added.
