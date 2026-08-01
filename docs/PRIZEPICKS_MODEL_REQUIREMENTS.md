# PrizePicks Model Requirements & Methodology

PrizePicks is **not** a traditional sportsbook. Diamond Edge does not price its
selections with an American line (e.g. `-110`), does not compute per-leg Kelly
staking, and does not call `model probability − 50%` the economic edge. Economic
value is computed from the **complete entry** against a configured payout table.

## Separated dimensions (never collapsed)

- **Probability** — `probabilityMore` / `probabilityLess` / `probabilityPush`
  from the coherent player simulation (`src/lib/prizepicks/entry/jointSim.ts`).
- **Confidence** — how much the model trusts its own estimate.
- **Data quality** — completeness/freshness of the inputs.
- **Volatility** — spread of the outcome distribution.
- **Fragility** — sensitivity of the probability to reasonable assumption changes.

These feed the **assessment policy** (`src/lib/prizepicks/assessment.ts`), which
returns a research status — `REVIEW` / `WAIT` / `AVOID` / `NO_EDGE` /
`UNAVAILABLE` — with explicit reasons and warnings. A high probability alone is
never a recommendation: an unconfirmed lineup, uncertain starter, stale line,
missing payout config, low data quality, extreme volatility, excessive fragility,
inadequate sample, or ambiguous mapping downgrades or blocks the selection.
Thresholds (research, **not** profitability): directional prob ≥ 0.58, confidence
≥ 70, data quality ≥ 75.

## Coherent simulation (shared game state)

Related markets for one player derive from a **single** simulated game, so they
cannot contradict each other:

- **Pitcher** — a sequence of batters faced through a bases-state run model
  yields strikeouts, outs, hits allowed, walks, HR allowed, and earned runs.
- **Hitter** — a plate-appearance sequence yields hits, singles/doubles/triples,
  HR, total bases, walks, and batter strikeouts. (Runs/RBIs need lineup state and
  are not fabricated — they are reported unsupported.)

## Versioned payout engine (`entry/payout.ts`)

`PrizePicksPayoutTable` carries `id`, `version`, `effectiveFrom/To`, `format`
(power/flex), `pickCount`, `rules` (`PayoutRule` with `payoutMultiplier` and
optional `refundMultiplier`), `source`, and `capturedAt`. Economics:

```
expectedReturn = Σ P(exactly k correct) · payoutMultiplier(k)
expectedProfit = stake · (expectedReturn − 1)
```

When no table is configured the engine returns `configured: false` and the UI/API
shows **"Payout configuration required"** — probabilities, correlation and
scenario analysis remain valid, but economic EV is withheld (never invented).

## Correlation-aware entry analysis (`entry/entry.ts`)

The entry distribution `P(exactly k correct)` comes from the **joint** simulation
(same-player-game legs correlated), never by multiplying marginals. When only
marginal probabilities are available, `entry/independence.ts` computes a
Poisson-binomial distribution explicitly labeled **`independence-approximation`**
with a prominent warning — never presented as equivalent to joint simulation.
Output includes the full correct-count distribution, `probAllWin`,
`downsideProbability`, correlation matrix + contradictions, variance/std, and
versioned payout economics.

## Immutable snapshots, grading, backtesting

- Pregame projection snapshots are immutable (`prizepicks/store.ts`); a changed
  line/lineup/pitcher/model version creates a **new** snapshot.
- Grading (`prizepicks/grading.ts`) scores archived selections from official
  results.
- Backtesting (`src/lib/backtest/metrics.ts`) is strictly chronological — any
  snapshot whose feature cutoff is after game start is excluded as leakage —
  reporting Brier, log loss, calibration buckets, MAE/RMSE, by-segment hit rate,
  and a drawdown proxy. Profitability is never claimed from a thin/selected
  sample; forward-recorded results are required before calling the model validated.

## No-guarantee statement

Nothing here is a lock, guarantee, safe money, sure bet, or cannot-miss.
Monte Carlo describes outcomes **under the model's assumptions**; it does not
prove the assumptions are correct, and iteration count is not evidence of
accuracy. The objective is to quantify uncertainty and reduce bad decisions.
