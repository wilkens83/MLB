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

## Quantitative engine (Phases 6–10) — COMPLETE
All under `src/lib/tennis/model/`. 47 engine tests; 168 total (86 MLB + 7 sports +
28 acquisition + 47 model). Lint + tsc + production build clean. Zero edits to the
protected computational core or the Phase 0–5 acquisition layer.

| Phase | Deliverable | Status | Notes |
|---|---|---|---|
| 6 | `TennisFeatureBuilder` | ✅ | 9 windows; serve/return/context features as `{value,sampleSize,source,freshness,missingReason}`; raw + Bayesian-shrunk; recency; no-future-data. |
| 7 | Elo rating engine | ✅ | Overall + per-surface, inactivity decay, no walkover update, chronological replay, `getPlayerRatingBefore` (no temporal leakage), match/set win prob. |
| 8 | Structural simulator | ✅ | Serve-point logit model → point→game→tiebreak→set→match; best-of-3/5; configurable tiebreak rules; aces/DF from service opportunities; seeded, batch API, distributions. |
| 9 | Market models | ✅ | `projectMarket`/`projectMarkets` for aces, double_faults, total_games, games_won, total_sets, sets_won, tie_breaks — all simulator-derived; fair-line sensitivity. |
| 10 | Assessment + provenance | ✅ | Separate probability/confidence/data-quality/volatility; configurable recommendation thresholds (low-quality can't be STRONG); structured reasons + warnings; `TennisModelVersion` with config checksum. |

Docs: `docs/tennis/SIMULATION_ENGINE.md`, `docs/tennis/PROJECTION_MODELS.md`.

## Remaining (scoped, not built yet)
| Phase | Deliverable | Status | Notes |
|---|---|---|---|
| 11 | Correlation from joint sims + entry builder | ⬜ | Simulator already emits joint samples; correlation extraction + builder deferred. |
| 12 | Frontend `/tennis/*` | ⬜ | Engine is UI-ready; slate/match/player views deferred. |
| 13 | Backtesting (temporal integrity) + observability | ⬜ | Elo + features are already leakage-safe; backtest harness deferred. |

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
- 2026-07-23 — Phases 6–10 complete: full quantitative engine under
  `src/lib/tennis/model/` (feature builder, Elo, structural simulator, market
  models, assessment + provenance). 47 engine tests incl. sanity scenarios A–E;
  168 total. Lint + tsc + production build clean; protected core + acquisition layer
  untouched. `SIMULATION_ENGINE.md` + `PROJECTION_MODELS.md` added.
