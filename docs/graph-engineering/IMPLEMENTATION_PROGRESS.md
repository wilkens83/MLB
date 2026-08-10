# Implementation Progress

Real, honest status of the Graph-of-Loops migration. The core statistical engine
is the foundation and is never replaced by an LLM.

## Phase 1 — Measurement foundation
- [x] Brier score, log loss, calibration buckets, MAE/RMSE (`src/lib/backtest/metrics.ts`)
- [x] Drift / PSI (`src/lib/backtest/drift.ts`)
- [x] Immutable pregame snapshots (`src/lib/prizepicks/ingestion/snapshot.ts` + Supabase scientific tables)
- [x] Grading history / official results tables (Supabase)
- [ ] Dedicated `/model-lab` measurement dashboard (planned)

## Phase 2 — Missing real context
- [x] Park factors wired into `buildAdjustmentBreakdown`
- [x] Lineup confirmed-vs-projected surfaced (`opponent.lineupConfirmed`)
- [x] Handedness fields resolved (`bats` / `throws`) and platoon adjustment in the engine
- [x] Freshness / provenance on Statcast + provider sources
- [ ] Real weather PROVIDER wired end-to-end (abstraction exists; live feed pending — currently reported "unavailable", never faked)

## Phase 3 — Modeling graph  ← THIS PHASE
- [x] `ModelOutput` / `EnsembleOutput` / `ModelDisagreement` contracts + versions (`src/lib/models/types.ts`)
- [x] Model C baseline control (`src/lib/models/baseline.ts`) — recency-weighted, no context
- [x] Parallel Model A (marginal) + Model B (PA, when applicable) + Model C via `computeModelEnsemble`
- [x] Versioned, renormalizing ensemble (`src/lib/models/ensemble.ts`)
- [x] Deterministic disagreement metric + severity (`src/lib/models/disagreement.ts`)
- [x] Additive wiring into `runAnalysis` (`analysis.models` / `.ensemble` / `.modelDisagreement`)
- [x] Surfaced in the research view model + Diamond Edge Model UI (per-model rows, ensemble, disagreement badge)
- [x] Tests: invariants (probs∈[0,1], sum→1, projection≥0), determinism, renormalization, missing-model, low/medium/high disagreement

## Phase 3.5 — Walk-forward measurement + persisted-prediction contracts  ← THIS PHASE
- [x] Canonical immutable `PredictionSnapshot` + `freezeSnapshot` (`src/lib/backtest/snapshot.ts`)
- [x] Temporal-leakage guard `checkNoLeakage` (`dataTimestamp <= predictionTimestamp < gameStartTime`) + tests
- [x] Postgame `gradePrediction` (reuses `clearsLine`; no re-derived prop formulas)
- [x] `runWalkForwardBacktest` — chronological, leakage-free, scores baseline/marginal/(pa)/ensemble SEPARATELY
- [x] Per-model comparison + byProp + byDisagreement + byDataQuality + ensemble calibration bins
- [x] Live adapter (`liveWalkForward.ts`) + `POST /api/backtest` + minimal read-only `/model-lab`
- [x] Weights NOT changed (measure first, tune later)
- [ ] Persist walk-forward reports + point-in-time snapshots to Supabase (currently computed on demand)
- [ ] Score PA (Model B) live from reconstructed point-in-time PA rates

## Phase 4 — Calibration
- [x] Calibration model + identity fallback (`unavailableCalibration`) — calibrated ≠ raw, calibrated null when no fit
- [ ] Fitted binning/isotonic calibrator from persisted grades (pending sufficient history)

## Phase 5 — Verification
- [x] Deterministic verifiers (`src/workflows/verification`) + Opportunity Engine veto gates
- [ ] Consolidated verifier node covering every check in the spec (partial today)

## Phase 6 — Daily slate
- [x] Slate orchestration (`src/lib/mlb/slate.ts`) with bounded concurrency
- [ ] Full `dailySlateGraph` on the graph executor with hierarchical reduce (partial)

## Phase 7 — PrizePicks integration
- [x] Import → normalize → resolve → evaluate via existing `runAnalysis` (no duplication)
- [x] Line-snapshot history, duplicate detection, pregame snapshots, grading

## Phase 8 — Research contracts
- [ ] `ContextEvent` typed contracts for future research agents (planned; no automatic LLM adjustment)

## Validation (this phase)
- Tests: 606 pass / 0 fail
- lint: clean · typecheck: clean · build: clean
