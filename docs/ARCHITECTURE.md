# Diamond Edge — Architecture

One Next.js 16 application. The analytics core is pure, testable, and independent
of both the data source and the UI. Subsystems live in their own namespaces and
reuse the shared core.

```
src/lib/math          Distributions, RNG, special functions (pure)
src/lib/odds          American/decimal/implied, no-vig, EV, Kelly, CLV, arbitrage (pure)
src/lib/analytics     Hit-rate windows, streaks, trend, consistency (pure)
src/lib/props         Prop catalog (prop → distribution family)
src/lib/prediction    projection · simulate · paSim (plate-appearance) · quality · engine
src/lib/mlb           client (timeout/retry/dedup/bounded cache) · api · series · context
                      · analysis (orchestrator) · slate · market · season (dynamic resolver)
src/lib/providers     mlbStats · statcast · arsenal · park · health (provider registry)
src/lib/prizepicks    import (CSV/manual) · resolver · market-map · evaluate · ranking
                      · grading · store (line + immutable pregame snapshots)
src/lib/prizepicks/entry   joint simulation · correlation/contradiction · payout · entry analysis
src/lib/backtest      metrics engine (Brier, log loss, calibration, MAE/RMSE, by-segment)
src/lib/sports        multi-sport registry (SportKey / adapter)
src/lib/tennis        self-contained tennis vertical (fixtures/manual/CSV — not live)
src/features/chat     AI Data Chat (typed tools · providers · orchestrator · UI)
src/app               routes + API handlers (nodejs, force-dynamic where fresh data is needed)
```

## Data pipeline (MLB)

- **Season is resolved, never hard-coded** — `src/lib/mlb/season.ts`.
  `getCurrentMlbSeason()` from the date; `getMlbSeasonForDate()` for historical
  requests (no temporal leakage). Offseason (Jan/Feb) → previous season.
- **Client** — `AbortController` timeouts, retry with bounded backoff (4xx not
  retried), in-flight de-duplication, size-bounded TTL cache (500 MLB / 100
  Savant, expired-then-oldest eviction), Zod validation on critical responses,
  structured errors, provider-health tracking. Missing values stay `undefined`
  (never coerced to 0).
- **Confirmed vs projected** — lineups inferred from a team's last game are
  labeled `projected`; probable pitchers carry `starterConfirmed`. Players are
  resolved by MLBAM id, never by name alone.
- **Statcast / Savant** — season leaderboards + pitch arsenal via CSV, cached
  hard; degrades gracefully (basic MLB analysis continues without Savant).

## Projection & simulation

`project()` recency-weights the game log (EWMA), shrinks toward a prior by
sample size, then applies multiplicative park/weather/matchup context. Batting
props PrizePicks can model directly run through the **plate-appearance
simulator** (`paSim.ts`); others use the marginal Monte Carlo (`simulate.ts`).
Every projection exposes mean/median/quantiles, P(More/Less/Push), confidence,
data quality, model version, dataAsOf/generatedAt. Determinism via a seeded RNG.

## PrizePicks decision system

Import (CSV/manual) → validate + dedupe with capture timestamp + source label →
resolve to MLBAM id + game (doubleheader-aware) → canonical market map (unknown
markets → review, never guessed) → evaluate via the **existing** engine (the
imported line is only a threshold) → rank → line-history + immutable pregame
snapshots → grading.

### Correlation-aware entry analysis (`src/lib/prizepicks/entry`)

Evaluates a **complete** Power/Flex entry, not isolated legs:

- **Joint simulation** (`jointSim.ts`) — a hitter's game (PA sequence) or a
  pitcher's game (batters faced through a bases-state run model) is simulated
  once per iteration, so multiple markets on the **same player-game** are
  correlated. Different player-games are independent (documented limitation).
- **Correlation + contradiction** (`correlation.ts`) — pairwise correlation from
  the joint 0/1 success indicators (never by multiplying marginals); flags
  internally-inconsistent pairs (e.g. More strikeouts + More hits allowed).
- **Payout** (`payout.ts`) — configurable Power/Flex multiplier tables (defaults
  are labeled configurable, never presented as guaranteed).
- **Entry** (`entry.ts`) — leg win probabilities, the P(k correct) outcome
  distribution, correlation/contradiction report, and expected payout.

Reachable from AI Data Chat via the `analyzeEntry` tool.

## Backtesting (`src/lib/backtest`)

`computeBacktest(snapshots, results)` scores immutable pregame projection
snapshots against official graded results: sample/push counts, hit rate, **Brier
score**, **log loss**, **calibration buckets**, MAE/RMSE, and by-segment
breakdowns (market, probability bucket, confidence bucket, lineup status, model
version), plus an even-money drawdown proxy. Strictly chronological — any
snapshot whose feature cutoff is after game start is excluded as leakage. Small
samples are flagged; profitability is never claimed from a thin/selected sample.

## AI Data Chat (`src/features/chat`)

Natural-language questions answered ONLY from real data through a controlled,
typed tool allow-list (no arbitrary SQL/modules/shell). `/api/chat`
(Zod-validated, rate-limited) → orchestrator (date/season resolution, guardrailed
`invoke`, validation, persistence) → provider (`mock` default / `anthropic`
env-gated). Tools: today's games, player search, projections, rankings,
comparison, data health, PrizePicks board + edges, **entry analysis**. Responses
are validated structured blocks (never raw HTML) with cited sources + freshness.

## Persistence

- Chat: server-side, session-keyed in-memory store shaped like the target tables
  (`chat_conversations`/`chat_messages`/`chat_tool_calls`/`chat_saved_queries`).
- PrizePicks board + snapshots: client localStorage today.
- **No SQL/migration layer yet** — interfaces are DB-ready for a Supabase/Postgres
  adapter (see Known limitations in `FEATURE_INVENTORY.md`).

## No-guarantee statement

Diamond Edge is a research and modeling tool. Projections are probabilistic
estimates, not guarantees. Nothing here is a "lock", "guaranteed", or "safe" bet.
Monte Carlo simulates the model's assumptions; it does not prove them correct.
