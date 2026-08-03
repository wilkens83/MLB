# Scientific-Quality Upgrade — Progress & Report

Goal: make Diamond Edge a **scientifically auditable** decision-support system —
point-in-time provenance, chronological validation against naive baselines,
distribution-drift monitoring, a full model-lifecycle gate, and scientific
circuit breakers — **without duplicating** any existing engine. Every change
extends a canonical module in place.

- **Base `main` SHA:** `301760644e44812f8de58ee2c5e909f6b8794af4`
- **Integration branch:** `integration/scientific-quality`
- **Status:** complete (pending PR merge into `main`).

## What changed (all in-place extensions of existing modules)

### Decision provenance & taxonomy (`src/lib/prizepicks/decision/`)
- **Entry taxonomy fixed.** A complete, possibly mixed-direction entry is now
  `APPROVE_ENTRY` — never mislabeled `BET_MORE` because it happens to contain a
  More leg. Legs keep the directional `BET_MORE` / `BET_LESS`; the entry-level
  states are `APPROVE_ENTRY / WAIT / NO_BET / UNAVAILABLE`
  (`types.ts` `entryDecisionSchema`, `anyDecisionSchema`). A Zod `superRefine`
  enforces the invariant: a LEG can never be `APPROVE_ENTRY` and an ENTRY can
  never be a directional BET.
- **Full model-lifecycle gate.** `marketValidationStateSchema` now carries all
  nine lifecycle states (`DEVELOPMENT`, `BACKTEST_ONLY`, `SHADOW`,
  `RESEARCH_ONLY`, `PROVISIONAL`, `VALIDATED`, `PRODUCTION`, `SUSPENDED`,
  `RETIRED`). `isBetEligibleState()` is the single source of truth: only
  `VALIDATED` / `PRODUCTION` may produce a firm BET, and `PROVISIONAL` only when
  the policy sets `allowProvisionalMarkets`. Every other state emits a blocking
  veto (`MARKET_SUSPENDED` / `MARKET_RESEARCH_ONLY` / `MARKET_NOT_ELIGIBLE`).
- **Scientific circuit breakers** (`veto.ts`): a degraded-calibration,
  feature-drift-exceeded, or outside-training-support signal forces `NO_BET`; a
  missing required simulation dependency forces `UNAVAILABLE`. All route through
  the mandatory veto engine, so a tripped breaker makes a firm BET impossible.
- **Payout-integrity gate.** A generic (unverified) default payout table can no
  longer back a firm decision: `payoutVerified === false` emits a
  `PAYOUT_UNVERIFIED` veto → `NO_BET`. `from-board.ts` marks board-derived
  payouts unverified by default.
- **Reproducibility provenance.** Every `DecisionResult` now carries
  `eventStartTime` (the point-in-time leakage boundary), `payoutVerified`, and an
  `inputHash` over the exact decision inputs, alongside the existing
  policy/model/payout versions and `configChecksum`.

### Chronological validation (`src/lib/backtest/`)
- **Baseline comparison** (`metrics.ts` `compareToBaselines`): scores the model's
  `probWin` against a coin-flip, a shrink-to-0.5, and any per-snapshot
  `baselineProbWin` on the **same** graded, non-leaked, non-push pairs (Brier +
  log loss, lower is better). A sophisticated model that cannot beat these
  naive baselines is not validated — the comparison makes that visible.
- **Distribution-drift monitoring** (`drift.ts`, new — no equivalent existed):
  Population Stability Index with `classifyDrift` (stable < 0.1 ≤ moderate <
  0.25 ≤ significant) and `assessDrift` producing the breach signal that feeds
  the decision engine's drift circuit breaker. Empty samples return 0 rather
  than throwing.
- The existing temporal-leakage guard (feature cutoff after game start → excluded)
  is honored by both the backtest report and the baseline comparison.

### UI / chat surfacing
- `/decisions` renders `APPROVE_ENTRY` (positive style, "APPROVE ENTRY" label,
  check icon).
- Chat response builder treats `APPROVE_ENTRY` as a bettable outcome for tone.

## Non-duplication ledger

| Need | Canonical module extended | New file? |
| --- | --- | --- |
| Entry taxonomy / lifecycle / provenance | `decision/types.ts` | no |
| Lifecycle + circuit-breaker vetoes | `decision/veto.ts`, `reasons.ts` | no |
| Payout-verification & entry state | `decision/evaluate-entry.ts` | no |
| Policy toggle | `decision/policy.ts` | no |
| Baseline comparison | `backtest/metrics.ts` | no |
| Input-distribution drift (PSI) | — (nothing scored input drift) | **yes: `backtest/drift.ts`** |

Only one new file was added, and only because no module scored input-distribution
drift (the backtest engine scores calibration/accuracy of outcomes, not input
shift). No `*-v2` / `-new` / parallel engine was created; no database or Python
layer was introduced.

## Validation (executed on the integration branch)

- **Lint:** `pnpm lint` — clean (exit 0).
- **TypeScript:** `pnpm exec tsc --noEmit` — clean (exit 0).
- **Unit tests:** `bun test src` — **352 passed, 0 failed** (30 files).
  New/extended coverage: `backtest/drift.test.ts` (PSI thresholds, breach,
  empty-input guard); `backtest/metrics.test.ts` (`compareToBaselines` beats
  coin-flip, provided-baseline series, leakage/push exclusion); `decision.test.ts`
  (APPROVE_ENTRY for mixed direction, payout-unverified → NO_BET, four circuit
  breakers, nine-state lifecycle gating incl. PROVISIONAL-by-policy, inputHash).
- **Build:** `pnpm build` — success.

## Known limitations

- Circuit-breaker inputs (calibration/drift/support flags) and
  `marketValidationState` are supplied to the engine as facts; wiring live PSI
  and forward-graded calibration into those flags is the next integration step.
- Live firm BET remains rare by design: data quality ≥ 85 and lifecycle
  `VALIDATED`/`PRODUCTION` are required, and markets default to `RESEARCH_ONLY`
  until forward-graded results exist.
- Persistence remains in-memory (interface DB-ready), unchanged by this mission.
