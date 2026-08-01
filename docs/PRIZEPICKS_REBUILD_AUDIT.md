# PrizePicks Rebuild Audit

**Base `origin/main`:** `f77963c58f85b4714794a913a6e2a7e480bd04ef`
**Integration branch:** `integration/prizepicks-diamond-edge`

## Finding: the PrizePicks path was already sportsbook-free

Auditing the PrizePicks path (`rg` over `src/lib/prizepicks`, `src/lib/odds`)
confirmed:

- **No `-110`, American-odds conversion, `kelly()`, or `fairAmerican`** anywhere
  under `src/lib/prizepicks` (verified and now enforced by
  `src/lib/prizepicks/no-sportsbook.test.ts`).
- `prizepicks/evaluate.ts` calls the shared engine **without** passing any price
  (`overAmerican`/`underAmerican`), so `recommendation.best` (which is what
  computes Kelly/EV/fair odds) is never populated for PrizePicks.
- `prizepicks/ranking.ts` scores from `probMore`/`probLess` and an explicitly
  **experimental** 0–100 score labeled "NOT a win probability".
- The American-odds engine (`src/lib/odds/math.ts`, incl. Kelly) is used **only**
  by the traditional Prop Explorer with **user-supplied** prices — a legitimate,
  separate surface — and is not imported by the PrizePicks path.

So the "remove sportsbook economics from PrizePicks" completion gates were
already satisfied structurally. This rebuild **adds** the missing PrizePicks-native
economics and policy rather than removing sportsbook logic.

## What this rebuild adds (absent before, on any branch)

| Area | Module | Notes |
|---|---|---|
| Versioned payout tables | `entry/payout.ts` | `PrizePicksPayoutTable` (id/version/effective dates/rules/refunds/source). Entry EV = Σ P(k)·mult; "Payout configuration required" when missing. |
| Independence approximation | `entry/independence.ts` | Poisson-binomial from marginals, **labeled** `independence-approximation` with a prominent warning. |
| Entry economics + method label | `entry/entry.ts` | `method`, `economics`, `downsideProbability`, `variance`. Joint sim by construction. |
| Assessment policy | `assessment.ts` | Separates probability/confidence/data-quality/volatility/fragility → REVIEW/WAIT/AVOID/NO_EDGE/UNAVAILABLE. |
| Regression guard | `no-sportsbook.test.ts` | Fails CI if the PrizePicks path ever reintroduces odds/Kelly/-110 as an economic basis. |
| Chat integration | `features/chat/tools/prizepicks/analyze-entry.ts` | Surfaces the versioned economics + method + downside. |

## Branch decisions (unchanged from the prior consolidation)

`origin/main` remains a strict superset of every remote branch; no valid
functionality lives only elsewhere. See `MAIN_CONSOLIDATION_AUDIT.md`. No branches
were merged (they hold only obsolete duplication) and none were deleted.
