# Evaluation Strategy

## Principle

**No predictive-accuracy claim without time-aware historical evidence.** Backtests
must never use information that was not available before the event.

## Time-aware backtesting

- Every scored prediction carries a `featureCutoff`. A prediction is eligible only
  when `featureCutoff <= eventStartTime`; anything else is **leakage** and is
  excluded (enforced in `lib/backtest/metrics.ts` and in persistence via
  `available_at <= feature_cutoff`).
- Point-in-time loading: the backtest workflow loads only observations knowable at
  the cutoff (see the scientific persistence layer's `observationsAvailableAt`).

## Metrics (`src/lib/backtest`)

- **Calibration**: Brier score, log loss, reliability bins (predicted vs observed),
  mean calibration error.
- **Discrimination / value**: ROI by probability bucket, ROI by market, hit rate,
  even-money drawdown proxy.
- **Baselines**: `compareToBaselines()` scores the model against coin-flip,
  shrink-to-0.5, and any captured per-snapshot baseline on the same graded pairs. A
  model that cannot beat naive baselines is **not** validated.
- **Sample sufficiency**: every metric reports `n` and flags thin samples;
  profitability is never claimed from a thin sample.
- **Drift**: PSI (`lib/backtest/drift.ts`) with an explicit `insufficient_data`
  verdict that blocks firm approval rather than reading as "stable".

## Model lifecycle gate

A market/model is `RESEARCH_ONLY` by default and only becomes BET-eligible through
forward-graded calibration (the decision engine's validation-state gate). The
evaluation output feeds that gate; it is never bypassed from the client.

## How verification uses evaluation

The `verify` sub-graph does **not** ask the production model whether it is right; it
runs deterministic bounds/stability/agreement checks and, for BET-eligibility,
defers to the persisted, forward-graded metrics — not to in-request self-assessment.
