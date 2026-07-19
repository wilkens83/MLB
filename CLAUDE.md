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

# Engine + data smoke tests (Bun runs pure logic; Node runs live-API tests):
bun run scripts/verify-engine.ts                                   # pure math/engine checks
NODE_EXTRA_CA_CERTS=$CA npx tsx --tsconfig tsconfig.json scripts/verify-data.ts  # live MLB pipeline
node scripts/shoot.mjs                                             # Playwright screenshots
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

## Conventions

- Path alias `@/*` → `src/*`.
- Pure engine modules must stay dependency-free and side-effect-free so they can
  run under Bun and in the browser. Keep I/O in `lib/mlb/*` and route handlers.
- Money/odds are always **American** at the boundary; convert internally.
- Charts are client components under `src/components/charts`; theme colors come
  from CSS variables (`var(--brand-500)`, `var(--positive)`, …) defined in
  `globals.css`, never hard-coded hex, so light/dark both work.
