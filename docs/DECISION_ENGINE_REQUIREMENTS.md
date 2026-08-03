# Firm Decision Engine — Requirements & Design

A strict, rules-based decision system for PrizePicks. Every candidate leg and
complete entry resolves to exactly one of five FINAL states:

```
BET_MORE · BET_LESS · WAIT · NO_BET · UNAVAILABLE
```

No vague labels (Lean, Maybe, Strong Lean, Good Play, Lock, Guaranteed, Safe
Money, Sure Bet, Cannot Miss).

## What "firm" means (and does not)

A firm decision applies **explicit, versioned, testable rules** to the available
data. It is **not** certainty and **not** guaranteed profit. The system is
deliberately conservative and is expected to reject most lines — a valid day may
be `2 BET / 4 WAIT / 9 NO_BET`, or even `0 BET`. The goal is to block weak,
fragile, incomplete, or economically negative decisions.

## Decision precedence (strict)

```
1. UNAVAILABLE   (cannot produce a valid decision)
2. WAIT          (may become valid after new info)
3. NO_BET        (complete enough to reject)
4. BET_MORE / BET_LESS
```

A lower-priority result never overrides a higher-priority blocker.

## Architecture (`src/lib/prizepicks/decision/`)

- `types.ts` — `FinalDecision`, `DecisionReason`, `DecisionVeto`,
  `DecisionPolicy`, `MarketValidationState`, `DecisionResult` (all Zod-validated).
- `policy.ts` — the versioned conservative policy (`DEFAULT_DECISION_POLICY`).
- `veto.ts` — the **mandatory** gate/veto computation (runs before any decision).
- `evaluate-leg.ts` — per-leg analytical direction (`MORE_CANDIDATE` /
  `LESS_CANDIDATE` / `REJECTED` / `WAITING` / `UNAVAILABLE`).
- `evaluate-entry.ts` — the FINAL entry decision (PrizePicks economics are
  entry-based, so a firm BET is only produced here).
- `sensitivity.ts` — real assumption sweep (opportunity, matchup, K axis) →
  base/worst/best selected-side probability + most-influential assumption +
  fragility.
- `market-validation.ts` — `RESEARCH_ONLY` / `PROVISIONAL` / `VALIDATED` /
  `SUSPENDED` from forward-graded results (unit tests are NOT validation).
- `store.ts` — immutable, append-only decision audit trail (new record on any
  change; grading is additive).
- `from-board.ts` — board → canonical decision pipeline (shared by the chat tool
  and `/api/prizepicks/decision`).

## Policy thresholds (`DEFAULT_DECISION_POLICY`, v1.0.0)

Provisional **research** thresholds — NOT proven-profitability thresholds; do not
loosen them to produce more BET decisions:

| Threshold | Value |
|---|---|
| minimum selected-side probability | 0.62 |
| minimum confidence | 80 |
| minimum data quality | 85 |
| maximum fragility | 30 |
| maximum volatility | 85 |
| minimum entry expected return | 1.05× |
| maximum line age | 15 min |
| confirmed player / game / hitter-lineup / probable-pitcher | required |
| payout table / pregame snapshot / no critical warnings | required |
| minimum forward sample per market | 100 |

The exact policy version + a config checksum are stored on every decision.

## Veto engine

`veto.ts` classifies every triggered condition into UNAVAILABLE / WAIT / NO_BET
and records **blocking vetoes** that make BET_MORE/BET_LESS impossible. Examples:
unresolved player/game, ambiguous doubleheader, game started, snapshot after
start, future-data leakage, unconfirmed required lineup/pitcher, unsupported
market, stale line, missing payout table, entry EV unavailable/below minimum,
provider conflict, data-quality floor, fragility ceiling, contradictory
simulation, unmodeled material correlation, unapproved model version, suspended
or research-only market. **A BET is impossible whenever any veto exists.**

## Leg vs. entry

Leg analysis (direction) is separate from the final entry action. A leg may be a
`MORE_CANDIDATE`, but if the complete entry's expected return is `0.91×`, the
final decision is `NO_BET`. PrizePicks economics use the **versioned payout
engine** (`entry/payout.ts`), never a `-110` assumption or per-leg Kelly.

## Market validation gate

Firm BET decisions require the market/model-version to clear the validation gate.
With no forward-graded sample, markets default to `RESEARCH_ONLY` (BET prohibited)
— so live BET is intentionally rare until forward results accumulate. The Decision
Center exposes an explicit "assume validated markets" research override.

## Runtime note

Because the policy is strict (data quality ≥ 85, confidence ≥ 80, worst-case
sensitivity ≥ 0.62) and real pregame data quality is often below 85, **live BET
is rare by design** — the four blocking states dominate, which is the intended
conservative behavior. BET_MORE/BET_LESS are produced by the engine whenever the
facts clear (28 unit tests) and rendered by the Decision Center UI.

## No-guarantee statement

Nothing here is a lock, guarantee, safe money, sure bet, or cannot-miss. The
system quantifies uncertainty and blocks bad decisions; establishing predictive
value requires forward-recorded results.
