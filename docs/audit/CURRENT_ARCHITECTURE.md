# Current Architecture — Audit (Phase 1)

_Snapshot of `main` @ `e9b3893`. Read-only audit; no production code was changed
to produce this document._

## Stack

Next.js 16 (App Router) · React 19 · TypeScript · Tailwind v4 · TanStack Query ·
Recharts · Zod · `@supabase/supabase-js`. Package manager **pnpm**; unit tests run
under **Bun** (`bun test src`). Path alias `@/* → src/*`.

## Layer map (as-built)

```
src/
  app/            40 files — App Router pages + route handlers (nodejs, force-dynamic)
    api/…         route handlers wrapping lib orchestrators
  components/      39 files — charts, prop cards, slate, shell, ui primitives, tennis
  features/        48 files — chat vertical (schemas/tools/server/llm/components)
  lib/            133 files — the analytics core + data + subsystems
    math/          pure distributions, RNG, special functions (no deps)
    analytics/     hit-rate windows, streaks, trend (pure)
    odds/          american/decimal/implied, no-vig, EV, Kelly, CLV (pure)
    props/         canonical prop catalog + dist family
    prediction/    projection, simulate, engine facade, paSim, adjustments, quality
    domain/        shared model types
    mlb/           client (TTL cache), api, series, context, analysis orchestrator
    providers/     mlbStats, statcast, arsenal, park, health, savantClient
    prizepicks/    board import, resolver, entry economics, decision engine
    backtest/      metrics, drift
    supabase/      client factories, scientific repositories, derive-facts
    sports/        multi-sport registry
    tennis/        self-contained sport namespace
    schemas/       shared validation helpers
```

## Dependency direction (observed)

The **pure core** (`math`, `analytics`, `odds`, `props`, `prediction/{projection,
simulate,engine}`) is genuinely dependency-free and side-effect-free — it runs
under Bun and in the browser. This is the project's biggest architectural asset
and must be preserved.

Around it:

- **`lib/mlb/analysis.ts`** is the server orchestrator (`runAnalysis`): fetch game
  log + Statcast → resolve opponent/park → build adjustment breakdown → run PA
  simulation or marginal Monte Carlo → quality-score → provenanced payload.
- **Route handlers** (`app/api/**`) are thin-ish wrappers that parse query params
  and call an orchestrator (`runAnalysis`, `buildSlate`, `computeMarketGameCards`,
  `decideEntryFromBoard`, `runChat`).
- **Client dashboards** fetch those routes via TanStack Query and render with
  Recharts.

Additive subsystems (chat, prizepicks, decision engine, backtest, supabase, tennis)
sit in their own namespaces and reuse the pure core without modifying it.

## Key flow: player-prop analysis (the vertical this migration targets first)

`PropDashboard` (client) → `GET /api/players/[id]/analysis` → `runAnalysis()` →
`getGameLog()` + `extractPropSeries()` + `buildContext()` → `project()` →
`simulate()`/`simulatePlateAppearances()` → `recommend()` → provenanced payload →
recommendation card + distribution/hit-rate/game-log charts.

Everything is computed **on the request path** (Monte Carlo included), with a TTL
cache in `lib/mlb/client.ts` for the upstream MLB fetches.

## What is genuinely good

- Pure, testable analytics core with a declared prop→distribution-family registry.
- Season is resolved, never hard-coded (`lib/mlb/season.ts`).
- Missing values stay `undefined`, never coerced to 0.
- Seeded RNG (`mulberry32`) → deterministic Monte Carlo per request.
- 32 colocated `*.test.ts` files; CI runs lint + tsc + `bun test src` + build.
- A firm decision engine with a mandatory veto layer and append-only persistence.

## Structural weaknesses (detailed in TECHNICAL_DEBT.md)

- Orchestration is **imperative and monolithic** (`runAnalysis` is one long async
  function): no typed step boundaries, no per-step timeout/retry/failure policy, no
  execution trace, no partial-failure semantics. One failing optional context
  source (weather, opponent) can throw and lose the whole analysis.
- **No workflow engine**: parallelism is ad-hoc `Promise.all`, there is no fan-in
  merge contract, no budget, no cancellation, no conditional routing.
- **Runtime validation is uneven**: chat + prizepicks + supabase validate with Zod;
  the MLB analysis payload crossing the route boundary is largely typed-only.
- **No independent verification layer**: sanity (probability bounds, sample
  quality, simulation stability, cross-method agreement) is entangled with the
  production functions that produce the numbers.
- **Observability is minimal**: `providers/health.ts` tracks per-source liveness,
  but there is no per-execution workflow trace (execution id, node timings, retry
  counts, cache status, warnings).
- **Route response envelopes are inconsistent** (`{error}` vs `{error, detail}` vs
  full payload); stack detail leaks in the analysis 502 path.
- **Test taxonomy is flat**: a single `test` script; no unit/contract/workflow/
  statistical separation, no explicit graph/leakage suites named as such.
