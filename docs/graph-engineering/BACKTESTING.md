# Backtesting

Diamond Edge is a probabilistic forecasting engine — primary evaluation is
**Brier score + calibration + log loss**, not win rate (which depends on selected
market lines).

## Existing foundation (reused)
- `src/lib/backtest/metrics.ts` — Brier, log loss (probability-clamped), calibration
  buckets, MAE/RMSE, by-segment aggregation.
- `src/lib/backtest/drift.ts` — Population Stability Index / drift classification.
- Immutable pregame snapshots + Supabase `official_results` / `grading_history`.

## Walk-forward (time-aware) — the required shape
Train through date X → predict X+1 → advance → repeat. Never random splits within a
season. Metrics: prediction count, Brier, log loss, MAE, RMSE, accuracy, win/push
rate, ROI (if prices), CLV (if closing lines).

## No temporal leakage (critical)
Data used to predict a game at time T must satisfy `fetchedAt <= predictionTimestamp`.
Backtests must never consume the final box score, post-snapshot lineups, future
Statcast, or post-snapshot market lines. Snapshots are immutable; a new line /
lineup / weather / model rerun creates a NEW snapshot version.

## Status — walk-forward IMPLEMENTED

- `src/lib/backtest/walkForward.ts` — `runWalkForwardBacktest(series, config)`: strictly
  chronological replay, leakage-free by construction (game i is predicted only from
  games 0..i-1), scoring **baseline / marginal / (pa when injected) / ensemble
  SEPARATELY** via the existing `computeBacktest`. Returns per-model Brier / log loss /
  MAE / RMSE / calibration-error, plus `byProp`, `byDisagreement`, `byDataQuality`
  segments and ensemble calibration bins. It never tunes weights.
- `src/lib/backtest/snapshot.ts` — canonical immutable `PredictionSnapshot` +
  `checkNoLeakage` guard (`dataTimestamp <= predictionTimestamp < gameStartTime`) +
  `freezeSnapshot`.
- `src/lib/backtest/grader.ts` — `gradePrediction` reuses `clearsLine` + Brier/log-loss;
  no re-derived prop formulas (actuals come from `extractPropSeries`).
- `src/lib/backtest/liveWalkForward.ts` — fetches multi-season game logs and builds
  series (server-only). PA (Model B) is not scored live yet — absent, never fabricated.
- `/model-lab` (read-only) + `POST /api/backtest` — runs a real featured backtest on
  demand and renders the per-model table, calibration bins, and segments. No fake demo
  metrics; thin samples are flagged and superiority is never claimed from a small N.

**Measure first, tune later:** ensemble weights (`pa .5 / marginal .35 / baseline .15`)
are unchanged this phase. The backtest now lets us test whether they beat baseline /
marginal / equal weighting before any tuning.
