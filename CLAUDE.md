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
- **Season is resolved, never hard-coded.** `src/lib/mlb/season.ts` is the single
  source of truth: `getCurrentMlbSeason()` derives the active season from the
  date (so July 2026 → 2026 with no code change at year rollover), and
  `getMlbSeasonForDate(date)` resolves a historical timestamp to the season it
  belonged to — a past game-log or box-score request never leaks the current
  season. The deep offseason (Jan/Feb) maps back to the previous, most-recently
  completed season. Every `season` default parameter across `mlb/api.ts`,
  `providers/statcast.ts`, and `providers/arsenal.ts` calls this resolver; do
  not reintroduce a literal year.
- **Caching is not Cache Components.** We intentionally do NOT enable
  `cacheComponents` (which would force `<Suspense>`/`use cache` everywhere).
  Freshness comes from the TTL cache in `mlb/client.ts` plus `force-dynamic`
  route handlers. Data-fetching pages are `export const dynamic = "force-dynamic"`.
  TTLs are tuned per data type (live game ~30s, schedule ~45s, lineups/splits
  ~10min, teams/rosters/player bio ~10–60min, boxscore/Savant CSV hours). Both
  the MLB and Savant in-memory caches are size-bounded (500 / 100 entries) with
  expired-then-oldest eviction so a long-running server can't grow them without
  limit. Missing Savant/Statcast values stay `undefined` and are reported as
  unavailable — never coerced to 0.
- **No API key needed.** `statsapi.mlb.com` and Baseball Savant's public
  leaderboards (`baseballsavant.mlb.com`, CSV) are both keyless. Sportsbook
  prices are user-supplied inputs to the odds math — there is no paid odds feed.
- **Live vs. projected.** Probable pitchers and box-score-derived lineups are
  labeled `projected`/`estimated` until MLB posts confirmed lineups (~1–2h
  pregame); the analysis payload carries `lineupConfirmed`/`starterConfirmed`
  and `meta.season`. Tennis ships on fixtures + manual/CSV providers (its live
  providers are inert), so it is not presented as a live feed.
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

- **AI Data Chat (`src/features/chat/`, `/api/chat`, `/chat`).** A conversational
  analytics workspace. Natural-language questions are answered ONLY from real
  project data through a **controlled, typed tool layer** — the model cannot query
  arbitrary modules, SQL, or shell. Flow: `/api/chat` (Zod-validated, rate-limited)
  → `orchestrator.runChat()` resolves date/season, builds the tool allow-list +
  a guardrailed `invoke` (max tools, per-tool timeout, row caps), loads recent
  turns + prior state, runs the configured provider, then validates + clamps the
  response and persists both messages. Tools reuse the existing engine
  (`runAnalysis`, `buildSlate`, `computeMarketGameCards`, `searchPlayers`,
  `savantStatcastProvider`, `evaluateEntry`, provider health). The provider is
  abstracted (`ChatModelProvider`): `mock` (default, offline, deterministic — no
  key) and `anthropic` (real, env-gated, prose-only so it's hallucination-proof
  by construction); `openai`/`google` are interface-ready but not shipped. The
  model returns only validated blocks (markdown/table/player-card/game-card/
  metric-grid/bar-chart/line-chart) — never raw HTML — each answer cites sources
  with freshness and carries `generatedAt`/`dataAsOf`/model version. Conversation
  memory is a server-side, session-keyed store shaped like the target DB tables.
  `CHAT_AI_PROVIDER` selects the provider (see `.env.example`); keys are
  server-only. Design docs: `docs/ai-data-chat/`.

- **Correlation-aware entry analysis (`src/lib/prizepicks/entry/`).** Evaluates a
  complete PrizePicks Power/Flex entry, not isolated legs. `jointSim.ts` simulates
  a player's game once per iteration (hitter PA sequence; pitcher batters-faced
  through a bases-state run model) so multiple markets on the **same player-game**
  are correlated; `correlation.ts` derives pairwise correlation from the joint 0/1
  indicators (never by multiplying marginals) and flags contradictions;
  `payout.ts` holds configurable Power/Flex tables (labeled configurable, never
  guaranteed); `entry.ts` returns leg win-probs, the P(k correct) distribution,
  and expected payout. Reachable via the chat `analyzeEntry` tool. Pure + tested.

- **Backtesting metrics (`src/lib/backtest/`).** `computeBacktest(snapshots,
  results)` scores immutable pregame snapshots vs graded results — Brier, log
  loss, calibration buckets, MAE/RMSE, by-segment (market/prob/confidence/lineup/
  model-version), even-money drawdown proxy. Strictly chronological: snapshots
  with a feature cutoff after game start are excluded as leakage; thin samples are
  flagged and profitability is never claimed from them. Pure + tested.

Other route-level pieces: `src/lib/mlb/slate.ts` + `/slate` (multi-game daily
board / player workbench) and `src/lib/mlb/market.ts` + `/api/market/game`
(team/game markets — NRFI, totals, run line). Design/consolidation docs live in
`docs/ARCHITECTURE.md`, `docs/MAIN_CONSOLIDATION_AUDIT.md`, and
`docs/FEATURE_INVENTORY.md`.

## Conventions

- Path alias `@/*` → `src/*`.
- Pure engine modules must stay dependency-free and side-effect-free so they can
  run under Bun and in the browser. Keep I/O in `lib/mlb/*` and route handlers.
- Money/odds are always **American** at the boundary; convert internally.
- Charts are client components under `src/components/charts`; theme colors come
  from CSS variables (`var(--brand-500)`, `var(--positive)`, …) defined in
  `globals.css`, never hard-coded hex, so light/dark both work.
