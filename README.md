<div align="center">

# 💎 Diamond Edge

### The MLB Player-Props Analytics Platform

Live MLB data · statistical projection · 10,000-iteration Monte Carlo · positive-EV signals

</div>

---

Diamond Edge turns a player's real box-score history into a true probability for
any prop market, then compares that probability to the price you're offered —
so you can see the **edge**, the **expected value**, and the **fair line** on
both sides of the bet.

It runs entirely on the **public MLB Stats API** and **Baseball Savant** (no key
required) and computes everything — projections, simulation, hit rates, EV,
Kelly — from first principles in TypeScript. No paid feeds, no black boxes.

The active season is **resolved dynamically** from the date
(`src/lib/mlb/season.ts`), so the app tracks the current MLB season with no code
change, and a request for a past date resolves to that date's season rather than
"now". Live network verification (`scripts/verify-data.ts`,
`scripts/verify-statcast.ts`) is separated from the deterministic unit suite.
Confirmed lineups only post ~1–2h before first pitch; until then lineups are
labeled **projected**. Tennis is a self-contained sport built on fixtures and
manual/CSV imports — it is not a live feed.

## Features

- **25 prop markets** across pitchers, hitters, teams and games — strikeouts,
  pitcher outs, earned runs, hits, home runs, total bases, H+R+RBI, singles,
  steals, fantasy points, NRFI/RFI, team totals, run line, game totals, and more.
- **Projection engine** — recency-weighted, Bayesian-shrunk rate estimates
  adjusted for ballpark, weather, and matchup.
- **Monte Carlo simulation** — 10,000 iterations per prop using Poisson /
  negative-binomial / normal models, producing a full probability distribution,
  credible intervals, and over/under probabilities.
- **Odds engine** — American ↔ decimal ↔ implied conversion, no-vig fair lines,
  expected value, edge %, quarter-Kelly staking, closing-line value, and
  two-way arbitrage detection.
- **Live analytics** — hit rate over L5/L10/L15/L20/L30/season, streaks, rolling
  averages, form vs season, consistency score, floor/ceiling percentiles.
- **Interactive dashboards** — animated distribution, game-log, hit-rate, and
  rolling-trend charts (Recharts) with live filters for line, price, side, and
  home/away splits.
- **AI Data Chat** — a conversational analytics workspace (`/chat`) that answers
  natural-language questions ("best strikeout projections today?", "compare Judge
  and Soto", "which PrizePicks lines have the highest edge?") from **real** project
  data through a controlled, typed tool layer. It never fabricates a stat: every
  number comes from a tool result, sources + freshness are cited, and unsupported
  questions are answered honestly. Runs offline with a deterministic mock provider
  (no API key); a real Anthropic provider is env-gated. See
  [`docs/ai-data-chat/`](./docs/ai-data-chat/architecture.md) and `.env.example`.
- **Luxury UI** — black + molten-orange glassmorphism, full light/dark theming,
  responsive, accessible, server-rendered.

## Tech stack

Next.js 16 (App Router, Turbopack) · React 19 · TypeScript · Tailwind CSS v4 ·
TanStack Query · Motion · Recharts · Lucide.

## Getting started

**Prerequisites:** Node 22+, pnpm 10+ (package manager, from the lockfile), and
Bun 1.3+ (runs the unit test suite and pure-logic scripts).

```bash
pnpm install
pnpm dev          # http://localhost:3000

pnpm lint         # eslint
pnpm exec tsc --noEmit
bun test src      # unit suite (deterministic, no network)
pnpm build        # production build (typechecks)
```

> **Sandboxed / proxied networks:** if outbound HTTPS is behind a
> TLS-intercepting proxy, point Node at its CA bundle so the server can reach the
> MLB API: `NODE_EXTRA_CA_CERTS=/path/to/ca-bundle.crt pnpm dev`.

## How a projection is built

1. **Extract** the per-game series for the prop from the player's live game log
   (`src/lib/mlb/series.ts`).
2. **Project** an expected rate: EWMA recency weighting → Bayesian shrinkage
   toward a prior → multiply by park/weather/matchup context
   (`src/lib/prediction/projection.ts`).
3. **Simulate** 10,000 games from the modeled distribution and blend the
   empirical over/under with the analytic CDF (`src/lib/prediction/simulate.ts`).
4. **Price it** against the market: model prob vs implied prob → edge, EV, fair
   line, Kelly (`src/lib/odds/math.ts`).

See [`CLAUDE.md`](./CLAUDE.md) for the full architecture map.

## Architecture

The pure analytics core is wrapped by a small internal **graph workflow engine**
(`src/workflows/graph`) with runtime **contracts** (`src/schemas`), **independent
verification** (`src/workflows/verification`), and **observability**
(`src/observability`). Dependency direction is UI → route handlers → workflows →
domain/core; the core, the engine, and the contracts import nothing from Next.js,
React, UI, or concrete external clients. The first migrated workflow is
**player-prop**, exposed opt-in at `GET /api/players/[id]/analysis?engine=graph`
behind a shared response envelope; default behavior is unchanged.

- Audit: [`docs/audit/`](./docs/audit) · Target architecture:
  [`docs/architecture/`](./docs/architecture) · Workflows:
  [`docs/WORKFLOWS.md`](./docs/WORKFLOWS.md) · Testing:
  [`docs/TESTING.md`](./docs/TESTING.md).

## Commands

```bash
pnpm dev            # dev server
pnpm build          # production build (tsc typecheck included)
pnpm lint           # eslint
pnpm typecheck      # tsc --noEmit
pnpm test:all       # full Bun suite (offline, deterministic)
pnpm test:contracts # Zod contract tests
pnpm test:workflows # graph engine + workflow tests
pnpm verify         # lint + typecheck + tests + build
```

## Disclaimer

Diamond Edge is a research and modeling tool for entertainment. It is **not
betting advice**. Gambling involves risk. 21+. Please play responsibly.
