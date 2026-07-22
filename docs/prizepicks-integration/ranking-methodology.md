# Ranking methodology (Experimental candidate score)

> This score is **experimental** and **not** a win probability. Until validated
> by calibrated backtesting it must never be presented as guaranteed/certain.

## Score (0–100)

```
score =  probabilityComponent      (0..45)
       + dataQualityComponent       (0..20)
       + modelAgreementComponent    (0..15)
       + freshnessComponent         (0..10)
       - uncertaintyPenalty         (0..15)
       - warningPenalty             (highs*12 cap 24, warns*4 cap 12)
       - roleUncertaintyPenalty     (0 or 8)
clamped to [0, 100]
```

| Component | Definition |
|---|---|
| probability | `(max(pMore,pLess) − 0.5) × 2 × 45`, clamped. Rewards directional edge over a coin flip. |
| dataQuality | `dq/100 × 20` (dq is the existing engine's data-quality score). |
| modelAgreement | `agreement × 15`, where agreement = 1 − \|model directional prob − recent-form directional rate\|. |
| freshness | line age <2h → 10, <6h → 6, <12h → 3, else 0. |
| uncertaintyPenalty | `(1 − (1 − e^(−n/12))) × 15` — larger for small samples `n`. |
| warningPenalty | high-severity warnings ×12 (cap 24) + warn ×4 (cap 12). |
| roleUncertaintyPenalty | 8 if lineup unconfirmed / starter uncertain / role uncertain. |

Weights live in `DEFAULT_WEIGHTS` (`src/lib/prizepicks/ranking.ts`) and are
configurable.

## Signal classification

- **Strong** — directional prob ≥ 0.60, data quality ≥ 70, model agreement ≥
  0.60, no high-severity warning, no role uncertainty, and a genuine pregame
  evaluation.
- **Lean** — directional prob ≥ 0.55, data quality ≥ 45, no high-severity warning.
- **Watch** — directional prob ≥ 0.52.
- **Avoid** — unresolved entry, any critical warning
  (`unresolved_player`, `game_unresolved`, `post_start`, `stale_line`,
  `conflicting_game`), or data quality < 30.

An **unresolved** entry can never be Strong.

## Why not rank on hit rate alone
Raw L5/L10 hit rate ignores sample size, opponent context, line difficulty,
freshness, and role certainty. The score blends the model's directional
probability with data quality, agreement, freshness, and explicit penalties so a
small-sample or stale/unconfirmed entry cannot outrank a well-supported one.

## Calibration dependency (not yet built)
A probability-calibration adjustment is reserved but **inactive** until pregame
snapshots have been graded (see `pregame_snapshots` + backtesting). Thresholds
here are provisional and must be re-tuned against calibration evidence.
