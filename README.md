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

It runs entirely on the **public MLB Stats API** (no key required) and computes
everything — projections, simulation, hit rates, EV, Kelly — from first
principles in TypeScript. No paid feeds, no black boxes.

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
- **Luxury UI** — black + molten-orange glassmorphism, full light/dark theming,
  responsive, accessible, server-rendered.

## Tech stack

Next.js 16 (App Router, Turbopack) · React 19 · TypeScript · Tailwind CSS v4 ·
TanStack Query · Motion · Recharts · Lucide.

## Getting started

```bash
pnpm install
pnpm dev          # http://localhost:3000
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

## Disclaimer

Diamond Edge is a research and modeling tool for entertainment. It is **not
betting advice**. Gambling involves risk. 21+. Please play responsibly.
