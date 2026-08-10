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

## Status
Metrics + drift + snapshots exist; a dedicated `runWalkForwardBacktest({ startDate,
endDate, props, minimumHistory })` API and the `/model-lab` dashboard are the next
priority (see IMPLEMENTATION_PROGRESS.md).
