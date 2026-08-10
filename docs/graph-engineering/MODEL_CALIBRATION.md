# Model & Calibration

## Parallel models (this phase)
Three deterministic models reuse the existing engine; none is an LLM:

| Model | Source | Notes |
|-------|--------|-------|
| A · marginal | `simulate(project(series))` | context-adjusted marginal Monte-Carlo; always present |
| B · pa | `simulatePlateAppearances` | structural PA model; PA-modeled batter props only; leads ensemble when present |
| C · baseline | `baselineModel` | recency-weighted control, NO context; a model that can't beat it adds no value |

**Ensemble** (`MODEL_ENSEMBLE_VERSION 1.0.0`): weighted average with configured
weights `{ pa:0.5, marginal:0.35, baseline:0.15 }`, **renormalized over present
models**; probabilities always sum to 1; contributions preserved; a missing model
is never fabricated.

**Disagreement**: `probabilityRange` / `projectionRange` / `stdDevProbability` →
`low|medium|high` (thresholds 0.08 / 0.15 on probOver range). High disagreement
lowers reliability and strengthens warnings; it never alters the projection.

## Calibration
`raw` and `calibrated` probability are DISTINCT. When no fitted calibrator exists
for the market/model version, calibration is `unavailable` and calibrated stays
`null` — raw is never relabeled as calibrated, and model advantage is not claimed.
A binning/isotonic calibrator will be fit from persisted grades once enough
point-in-time history accumulates (`calibrationStatus = insufficient_data` until then).

## Rule: measure before changing coefficients
EWMA half-life, prior weight, park/weather/platoon/form/opponent factors, and
ensemble weights are only changed when a **walk-forward** backtest shows a
Brier/log-loss/calibration improvement — never tuned on the reported set.
