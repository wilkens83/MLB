# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

@AGENTS.md

## What this is

**Diamond Edge** is an MLB player-props analytics platform. It pulls live data from
the public MLB Stats API, models every supported prop with a statistical
projection + Monte Carlo simulation engine, and surfaces positive-EV betting
signals against a user-supplied market price. Next.js 16 (App Router) + React 19
+ Tailwind v4.

## Commands

```bash
pnpm dev            # dev server (Turbopack) on :3000
pnpm build          # production build (runs tsc typecheck)
pnpm start          # serve the production build
pnpm lint           # eslint (next lint / flat config)

# Unit tests — colocated *.test.ts (math, odds, hitRate, engine, prizepicks,
# sports, tennis, savantClient). Run under Bun's test runner:
pnpm test                                       # bun test src (whole suite)
bun test src/lib/math/stats.test.ts             # one file
bun test src -t "no-vig"                         # filter by test name

# Engine + data smoke tests (Bun runs pure logic; Node runs live-API tests):
bun run scripts/verify-engine.ts                                   # pure math/engine checks
NODE_EXTRA_CA_CERTS=$CA npx tsx --tsconfig tsconfig.json scripts/verify-data.ts     # live MLB pipeline
NODE_EXTRA_CA_CERTS=$CA npx tsx --tsconfig tsconfig.json scripts/verify-statcast.ts # live Baseball Savant pipeline
node scripts/shoot.mjs                                             # Playwright screenshots (also shoot-slate/-analyze/-prizepicks/-redesign)
```

### Sandbox networking gotcha

Outbound HTTPS goes through a TLS-intercepting proxy. **Node** honors the proxy
only with `NODE_EXTRA_CA_CERTS=/root/.ccr/ca-bundle.crt` set, so the Next.js
dev/build/start process needs it to reach `statsapi.mlb.com`:

```bash
NODE_EXTRA_CA_CERTS=/root/.ccr/ca-bundle.crt pnpm dev
```

**Bun's** `fetch` does not work through this proxy (ECONNRESET) — use Bun only for
pure-logic tests (`scripts/verify-engine.ts`), and Node/`tsx` for anything that
hits the network. This env var is sandbox-specific and must NOT be baked into
committed scripts (it would break real deployments, where no such proxy exists).

## Architecture

The codebase is deliberately layered so the analytics core is pure, testable,
and independent of both the data source and the UI.

```
src/lib/math/stats.ts        Distributions, RNG, special functions (pure, no deps)
src/lib/props/catalog.ts     Canonical registry of every prop market + its dist family
src/lib/analytics/hitRate.ts Hit-rate windows, streaks, trend, consistency (pure)
src/lib/odds/math.ts         American/decimal/implied, no-vig, EV, Kelly, CLV, arbitrage (pure)
src/lib/prediction/
  projection.ts              Series -> rate estimate (recency + Bayesian shrinkage + context)
  simulate.ts                Monte Carlo (10k) -> distribution, P(over/under), CI, recommendation
  engine.ts                  analyzeProp(): the single facade tying it all together
src/lib/mlb/
  client.ts                  MLB Stats API fetch w/ in-memory TTL cache + dedup + retry
  api.ts                     Typed high-level calls (schedule, players, game logs)
  series.ts                  Game log -> per-game numeric series per prop (derives singles/FP/outs)
  context.ts                 Park factors + weather -> projection context multipliers
  analysis.ts                Server orchestrator: fetch log -> extract -> analyzeProp
src/app/api/...              Route handlers wrapping api.ts / analysis.ts (nodejs, force-dynamic)
src/app/...                  Server components fetch via lib/mlb; client dashboards fetch the API
```

### Key design decisions

- **Prop → distribution family** is declared in `props/catalog.ts` (`poisson`,
  `negbinom`, `bernoulli`, `normal`). Adding a prop = one catalog entry + one
  extractor in `series.ts`. The engine and UI are otherwise prop-agnostic.
- **The projection is the model.** `project()` recency-weights the game log
  (EWMA half-life), shrinks toward a prior by sample size, then applies
  multiplicative park/weather/matchup context. The Monte Carlo in `simulate.ts`
  draws from the resulting distribution and blends the empirical over/under
  probability with the closed-form CDF for tail stability.
- **Caching is not Cache Components.** We intentionally do NOT enable
  `cacheComponents` (which would force `<Suspense>`/`use cache` everywhere).
  Freshness comes from the TTL cache in `mlb/client.ts` plus `force-dynamic`
  route handlers. Data-fetching pages are `export const dynamic = "force-dynamic"`.
- **No API key needed.** `statsapi.mlb.com` is public. Sportsbook prices are
  user-supplied inputs to the odds math — there is no paid odds feed wired in.
- **Determinism.** Monte Carlo uses a seeded RNG (`mulberry32`) keyed by
  player/prop/line so a given request reproduces the same simulation.

### Where things connect

`PropDashboard` (client) → `GET /api/players/[id]/analysis` → `runAnalysis()` →
`getGameLog()` + `extractPropSeries()` + `buildContext()` → `analyzeProp()` →
`{ projection, simulation, analytics, recommendation }` rendered by the
recommendation card, distribution/hit-rate/game-log/rolling charts.

## Subsystems layered on top of the MLB core

The sections above describe the founding MLB engine. Four additive subsystems
have since been built _around_ it without changing it — each stays in its own
namespace and reuses the pure core.

- **Provider registry (`src/lib/providers/`).** The single seam for data
  sources: `mlbStats` (schedule/players/logs), `savantClient` + `statcast` +
  `arsenal` (Baseball Savant pitch-level / Statcast, powering the pitch-mix and
  arsenal panels), `park` (static park factors), and `health` (per-provider
  liveness surfaced by the data-health indicator). Consumers import from
  `providers/index.ts` and swap/mocks happen there — so "no API key needed"
  now means _plus_ the public Savant endpoints, still keyless.

- **Multi-sport registry (`src/lib/sports/`).** Turns Diamond Edge from an MLB
  app into a platform. Code asks the registry (`getSport`/`enabledSports`),
  never a sport directly. `SportKey = "mlb" | "tennis"`; MLB is registered
  eagerly, a sport ships behind `SportDefinition.enabled`. A `SportMarket`
  reuses the shared `DistFamily` families so the engine simulates it with no
  sport-specific code; `structural: true` markets are driven by a per-sport
  Monte Carlo + `summarizeSamples` instead of a closed-form draw. The change
  is deliberately non-invasive: the pure core (math/odds/simulate/hitRate) was
  already sport-neutral.

- **Tennis vertical (`src/lib/tennis/`, `src/app/tennis/`).** A self-contained
  sport namespace: `data/` (acquisition + identity + derive), `providers/`
  (fixture/manual/live/historical-CSV behind a registry), `model/` (a
  structural point→game→set→match simulator, ratings, fair lines). Importing
  `tennis/index.ts` self-registers the sport via side effect; nothing in the
  MLB path imports it, so it stays fully isolated. Design docs live in
  `docs/tennis/`.

- **PrizePicks integration (`src/lib/prizepicks/`, `/api/prizepicks/*`,
  `/prizepicks-board`).** Import a PrizePicks board (CSV/paste), resolve each
  entry to an MLB player + canonical market (`player-resolver`, `market-map`,
  `normalize`), then evaluate it by calling the **existing** `runAnalysis`
  unchanged — the imported line is used only as the threshold, never fed into
  the projection. Adds ranking/grading on top. The "protected core" contract
  (engine is never modified) is documented in
  `docs/prizepicks-integration/`.

Other route-level pieces: `src/lib/mlb/slate.ts` + `/slate` (multi-game daily
board / player workbench) and `src/lib/mlb/market.ts` + `/api/market/game`
(team/game markets — NRFI, totals, run line).

## Conventions

- Path alias `@/*` → `src/*`.
- Pure engine modules must stay dependency-free and side-effect-free so they can
  run under Bun and in the browser. Keep I/O in `lib/mlb/*` and route handlers.
- Money/odds are always **American** at the boundary; convert internally.
- Charts are client components under `src/components/charts`; theme colors come
  from CSS variables (`var(--brand-500)`, `var(--positive)`, …) defined in
  `globals.css`, never hard-coded hex, so light/dark both work.
