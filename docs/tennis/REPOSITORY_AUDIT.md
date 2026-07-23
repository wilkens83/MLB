# Tennis Integration — Phase 0: Repository Audit

> **Status:** Complete · **Date:** 2026-07-23 · **Author:** Diamond Edge engineering
>
> This is an honest, load-bearing audit written *before* any tennis code was added.
> It documents what the platform actually is today, what can be reused as-is, where
> MLB assumptions are welded into the core, what must be built new, and the exact
> order in which the tennis work will proceed. Nothing here is aspirational: every
> claim about "reusable" was verified by reading the file.

---

## 1. What Diamond Edge is today

Diamond Edge is a **single-sport (MLB) player-props analytics platform**. It is a
Next.js 16 (App Router) + React 19 + Tailwind v4 application with **no database, no
auth, no job scheduler, and no CI/CD**. All persistence is either an in-memory TTL
cache (server) or `localStorage` (client). Data comes live from the public MLB Stats
API and Baseball Savant; there is no paid feed and no ingested historical corpus.

```
Runtime:        Next.js 16 App Router, server components + force-dynamic route handlers
Analytics core: pure TypeScript, dependency-free, runs under Bun and in the browser
Persistence:    in-memory TTL cache (src/lib/mlb/client.ts) + client localStorage
Data sources:   statsapi.mlb.com (keyless), baseballsavant.mlb.com (CSV leaderboards)
Tests:          bun test src — 86 pass across 6 files (pure logic only)
Validation:     Zod at the provider boundary (src/lib/schemas)
```

### The layering that matters

The single most important architectural fact for tennis is that **the analytics
core is already sport-agnostic in spirit, but MLB-coupled in its types.** The math
does not know what baseball is; the catalog and domain models do.

```
src/lib/math/stats.ts         Distributions, mulberry32 RNG, EWMA — ZERO domain knowledge
src/lib/odds/math.ts          American/decimal/implied, no-vig, EV, Kelly, CLV, arbitrage — ZERO domain knowledge
src/lib/analytics/hitRate.ts  Hit-rate windows, streaks, trend — operates on number[] only
src/lib/prediction/simulate.ts   Monte Carlo over a distribution family — operates on Projection only
src/lib/prediction/projection.ts recency + shrinkage + context multiplier — operates on number[] only
src/lib/prediction/engine.ts     analyzeProp() facade — depends on props/catalog (MLB prop keys)
src/lib/props/catalog.ts      MLB prop registry (strikeouts, hits, HR, …) — MLB-SPECIFIC
src/lib/domain/models.ts      PlayerEntity/GameEntity/StatcastBatter/… — MLB-SPECIFIC
src/lib/providers/*           MLBStatsProvider/StatcastProvider interfaces — MLB-SPECIFIC
src/lib/mlb/*                 fetch + normalize + orchestrate — MLB-SPECIFIC
src/lib/prizepicks/*          adapter over the engine — MLB-SPECIFIC market map
```

---

## 2. Reusable-as-is (no changes needed)

These modules have **no baseball knowledge** and will be consumed directly by the
tennis engine. This is the foundation that makes "one platform, many sports" real
rather than a slogan.

| Module | Why it is sport-neutral | Tennis use |
|---|---|---|
| `src/lib/math/stats.ts` | Pure distributions, seeded RNG, special functions. Input is numbers. | Point/game/set simulation draws, Beta/Binomial for serve-hold, Elo logistic. |
| `src/lib/odds/math.ts` | American↔decimal↔implied, no-vig, EV, edge, Kelly, CLV, arbitrage. | Identical — a tennis moneyline is priced with the same math as an MLB moneyline. |
| `src/lib/analytics/hitRate.ts` | `analyzeStat(series: number[], line, side)` — windows, streaks, trend, consistency. | Player form over last-N matches (aces, games won, etc.). |
| `src/lib/prediction/simulate.ts` | `simulate(projection, line)` + `summarizeSamples(samples[], line)`. The latter is the key hook: **any** model that can emit an array of simulated outcomes gets a full `SimulationResult` (probOver, CIs, distribution) for free. | Structural match sim emits per-match totals (total games, aces, sets) → `summarizeSamples`. |
| `src/lib/prediction/quality.ts` | Data-quality scoring + warning codes from sample size / source availability. | Same governance surface for tennis predictions. |
| `src/lib/schemas/validate.ts` | Generic Zod safe-parse wrapper with graceful degradation. | Validate tennis provider payloads at the boundary. |
| Design system | `PlayerAvatar`, `data-badges`, `primitives`, `card`, CSS-variable theming in `globals.css`. | Tennis player cards, match cards, recommendation cards reuse the same primitives. |

**Design principle to preserve:** `simulate.ts` already separates *"draw from a
declared distribution family"* (`simulate`) from *"summarize an array a model
produced"* (`summarizeSamples`). Tennis is fundamentally a **structural** sport
(points → games → sets → match), so it will lean almost entirely on
`summarizeSamples` fed by a point-level Monte Carlo — the exact seam the MLB
plate-appearance simulator already uses (`src/lib/prediction/paSim.ts` → `summarizeSamples`).

---

## 3. Reusable-as-a-pattern (copy the shape, not the code)

These are MLB-specific but establish a **proven pattern** the tennis layer should
mirror rather than invent from scratch:

| Pattern | Established in | Tennis analogue |
|---|---|---|
| **Provider interface → concrete adapters → registry** | `src/lib/providers/{types,index}.ts` | `TennisDataProvider` interface + Sportradar/SportsDataIO/ApiTennis/HistoricalCsv/Manual adapters + registry with failover. |
| **Normalized domain models; engine never sees raw API shapes** | `src/lib/domain/models.ts` | `src/lib/tennis/domain/*` — providers map upstream → normalized `TennisMatch`/`TennisPlayer`. |
| **Zod validation at the boundary, degrade gracefully** | `src/lib/schemas/mlb.ts` + `validate.ts` | `src/lib/tennis/schemas/*` — reject malformed rows, never crash the pipeline. |
| **Catalog-driven markets (prop → distribution family)** | `src/lib/props/catalog.ts` | Tennis market catalog (match winner, total games, set betting, aces, etc.) with families. |
| **Adapter-only integration (PrizePicks reads the untouched engine)** | `src/lib/prizepicks/*` | Any tennis board import reuses the same adapter discipline; the engine stays pure. |
| **Identity resolution that never joins by name alone** | `src/lib/prizepicks/player-resolver.ts` (name + team + role) | Tennis identity resolution: name + tour + DOB/country + external-id crosswalk. |
| **In-memory TTL cache + dedup + retry** | `src/lib/mlb/client.ts` | A sport-neutral `httpCache` the tennis client also uses (candidate refactor). |

---

## 4. MLB-specific coupling (the honest list)

Everything below **assumes baseball** and must NOT be forced onto tennis. The
tennis integration introduces a parallel domain, not edits to these files.

1. **`src/lib/props/catalog.ts`** — `PropCategory = "batter" | "pitcher" | "team" | "game"`.
   Every prop key (strikeouts, hits, home_runs, …) reads MLB box-score `statKeys`.
   Distribution families (`poisson`/`negbinom`/`bernoulli`/`normal`) are *reusable*,
   but the catalog entries are not.
2. **`src/lib/domain/models.ts`** — `PlayerEntity.isPitcher`, `bats`/`throws`,
   `GameEntity.gamePk`/`inning`, `StatcastBatter`/`StatcastPitcher`, `BallparkEntity`,
   `WeatherEntity`. Baseball to the bone.
3. **`src/lib/providers/types.ts`** — `MLBStatsProvider`, `StatcastProvider`,
   `ParkFactorProvider` interfaces speak schedules, game logs, Statcast rows.
4. **`src/lib/mlb/*`** — `series.ts` derives singles/FP/outs from box scores;
   `context.ts` is park factors + weather; `analysis.ts` resolves the opposing
   *starter*; `slate.ts`/`market.ts` are inning/lineup shaped.
5. **`src/lib/prizepicks/market-map.ts`** — maps PrizePicks labels to MLB prop keys only.
6. **UI copy & nav** — `app-sidebar.tsx` hard-codes "MLB · Player Props"; routes are
   `/games/[gamePk]`, `/players/[id]`, etc. No sport in the URL space.

**There is no `SportKey` anywhere.** The concept of "which sport" does not exist in
the codebase today. Introducing it is Phase 1 and is the linchpin of the whole effort.

---

## 5. Critical infrastructure GAPS (what the tennis spec assumes but does not exist)

The 20-phase tennis spec references capabilities this repo **does not have**. Being
honest about this now prevents building on sand:

| Assumed by spec | Reality today | Plan |
|---|---|---|
| Relational **database** + migrations | None. TTL cache + localStorage only. | Historical imports target an **abstracted `HistoricalStore` interface** with a file/JSON-backed implementation first; a real DB is a later, explicitly-scoped phase — not smuggled in silently. |
| **Job scheduler** for ingestion/backfill | None. | Acquisition is exposed as **idempotent scripts** (`scripts/tennis/*`) runnable on demand; scheduling is deferred and documented as such. |
| **Auth / user accounts** | None. | Out of scope; entry builder stays client-side like the PrizePicks board. |
| **CI/CD** | None. `bun test src` run manually. | Keep tests green manually; document a CI target, do not fabricate a pipeline. |
| Live **tennis provider credentials** | None in this environment. | Every provider adapter ships as **interface + typed fixtures + docs**. No adapter is described as "production-verified." Providers are inert without credentials by design. |
| **Entry builder / correlation from joint sims** | None (MLB has no parlay builder either). | Built on the tennis structural sim once the domain + acquisition layers land. |

**Compliance constraints carried into every phase (non-negotiable):** no account
automation/login/credential storage; no CAPTCHA/anti-bot bypass; no scraping of
protected pages; never fabricate or mock data in production paths (fixtures are
test-only and labeled); every unavailable metric returns an explicit *unavailable*
status; never join players by name alone; provider API keys stay server-side; CSV
imports reject formula-injection cells; never describe an unverified provider as
production-verified.

---

## 6. Required refactors (minimal, non-breaking)

The guiding rule: **additive, not invasive.** MLB behavior must be byte-for-byte
unchanged (all 86 tests keep passing; Skenes K projection stays identical).

1. **Introduce a sport registry** — `src/lib/sports/` with
   `SportKey = "mlb" | "tennis"`, a `SportDefinition` (label, markets, adapter), and a
   `SportAdapter` contract. MLB is registered as the first entry by *describing* the
   existing engine, not rewriting it. **No existing MLB file is edited to achieve this.**
2. **(Optional, later) Extract a sport-neutral `httpCache`** from `mlb/client.ts` so
   the tennis client shares dedup+TTL+retry. Deferred until the tennis client exists,
   to avoid churning MLB code prematurely. Documented, not done in Phase 1.
3. **Namespace tennis under `src/lib/tennis/*`** mirroring the MLB layout
   (`domain/`, `schemas/`, `providers/`, `data/`, `prediction/`) so the two sports are
   siblings, never entangled.
4. **URL space** — tennis routes live under `/tennis/*`; MLB routes are left as-is for
   now (a later cosmetic phase may namespace them under `/mlb/*` behind redirects).

No refactor in this list mutates the protected computational core enumerated in
`docs/prizepicks-integration/protected-core.md`.

---

## 7. Risks & mitigations

| Risk | Likelihood | Mitigation |
|---|---|---|
| Tennis work regresses MLB behavior | Medium | Additive-only rule; `bun test src` gate every commit; git-diff audit confirms zero edits to protected core. |
| Over-building infra (DB/jobs) that isn't needed yet | High | Interface-first (`HistoricalStore`), file-backed impl, DB explicitly deferred. |
| Providers look "real" but have no credentials | High | Fixtures are labeled test-only; adapters throw/degrade without keys; docs state verification status honestly. |
| Structural sim complexity (point→game→set→match, tiebreaks, best-of-3 vs 5) | Medium | Build incrementally with unit tests at each structural level; validate against known serve-hold → match-win identities. |
| Player identity collisions across tours/providers | Medium | Multi-key resolution (name + tour + country + DOB + external-id map); never name-alone; surface `ambiguous` like the PrizePicks resolver. |
| Scope sprawl (20 phases) | High | Ship verifiable vertical slices; this audit fixes the order below. |

---

## 8. Migration & rollback strategy

- **Migration:** purely additive. New code lives under `src/lib/sports/`,
  `src/lib/tennis/`, `src/app/tennis/`, `scripts/tennis/`, `docs/tennis/`. The sport
  registry is opt-in; nothing imports it into the MLB path.
- **Feature flag:** tennis routes/nav can be gated behind a single
  `SPORTS_ENABLED` constant so the tennis surface can be hidden without reverting code.
- **Rollback:** because the change set is isolated to new directories, rollback is
  `git revert` of the tennis commits with **zero** risk to the MLB product. The MLB
  test suite is the tripwire — if it ever goes red, the offending tennis commit is
  reverted before proceeding.

---

## 9. Exact implementation order

Each step is an independently shippable, tested slice. "the Tennis data acquisition
layer" (this task) is Phases 0–5.

0. **Repository audit** (this document) + `IMPLEMENTATION_PROGRESS.md`. ✅
1. **Multi-sport core** — `src/lib/sports/`: `SportKey`, `SportDefinition`,
   `SportAdapter`, registry. Register MLB descriptively. Non-breaking. Unit tests.
2. **Tennis domain types** — `src/lib/tennis/domain/`: `TennisPlayer`, `Tournament`,
   `Match`, `MatchStats`, `RankingSnapshot`, projection/prediction types; enums
   `TennisTour`/`Surface`/`Environment`/`Market`.
3. **Tennis market catalog + Zod schemas** — market registry (winner, total games,
   sets, aces, …) mapped to distribution families; boundary validation.
4. **TennisDataProvider abstraction + adapters** — interface + Sportradar /
   SportsDataIO / ApiTennis / HistoricalCsv / Manual adapters as interface + fixtures
   + docs (no credentials); registry with failover + health tracking.
5. **Data acquisition layer** — live / historical / projection orchestration over
   fixtures; **player identity resolution** (never name-alone); reconciliation across
   providers; idempotent acquisition scripts. Unit tests.
6. **Structural match simulation** — point → game → set → match Monte Carlo (best-of-3
   and 5, tiebreaks) feeding `summarizeSamples`. Surface-aware.
7. **Elo / surface-Elo rating** — ratings feed serve/return parameters.
8. **Market models** — winner, total games, set betting, aces/double-faults, handicap.
9. **Correlation from joint simulations** + entry builder.
10. **Frontend** — `/tennis` slate, match view, player view, board import.
11. **Backtesting** with temporal integrity; observability; docs.

Phases 6–11 are scoped here but implemented after the acquisition layer (0–5) lands
and is verified green.

---

## 10. Definition of done for the acquisition layer (0–5)

- [ ] `docs/tennis/REPOSITORY_AUDIT.md` + `IMPLEMENTATION_PROGRESS.md` committed.
- [ ] `src/lib/sports/` registry with MLB registered; MLB tests still 86/86.
- [ ] `src/lib/tennis/domain/` complete and typed.
- [ ] Tennis market catalog + Zod schemas with tests.
- [ ] `TennisDataProvider` + adapters (fixtures/docs) + registry with health/failover.
- [ ] Acquisition orchestration + identity resolution, all covered by unit tests.
- [ ] `bun test src` green (86 MLB + new tennis tests); `pnpm lint` clean; build clean.
- [ ] Git-diff audit confirms **zero** edits to the protected computational core.
