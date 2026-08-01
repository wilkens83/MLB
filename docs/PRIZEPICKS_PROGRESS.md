# PrizePicks Rebuild — Progress

- **Current phase:** complete (pending PR merge into `main`).
- **Base `main` SHA:** `f77963c58f85b4714794a913a6e2a7e480bd04ef`
- **Integration branch:** `integration/prizepicks-diamond-edge`

## Completed requirements

- Versioned, configurable PrizePicks payout engine (`entry/payout.ts`) — Power &
  Flex tables with refund rules, versioned + effective-dated + sourced.
- Complete-entry economics: `expectedReturn = Σ P(k)·multiplier`,
  `expectedProfit = stake·(return−1)`, downside probability; withheld with
  **"Payout configuration required"** when unconfigured.
- Flex vs Power evaluated separately.
- Correct-count distribution from **joint** simulation (correlation-aware);
  **independence-approximation** path (`entry/independence.ts`) explicitly
  labeled + warned when only marginals exist.
- Related markets derive from one shared player simulation (no contradictions).
- Separated probability / confidence / data-quality / volatility / fragility with
  the assessment policy (`assessment.ts`) → REVIEW/WAIT/AVOID/NO_EDGE/UNAVAILABLE.
- Regression guard proving the PrizePicks path uses no `-110`/Kelly/American odds.
- Chat `analyzeEntry` tool surfaces the versioned economics + method + downside.
- Documentation (`PRIZEPICKS_MODEL_REQUIREMENTS.md`, this file, rebuild audit).

## Validation (executed on the integration branch)

- **Failing command:** none.
- **Lint:** `pnpm lint` — clean (exit 0).
- **TypeScript:** `pnpm exec tsc --noEmit` — clean (exit 0).
- **Unit tests:** `bun test src` — **294 passed, 0 failed** (26 files).
- **Build:** `pnpm build` — success.
- **Runtime:** live `analyzeEntry` on a real board (Skenes ×2 + Judge) →
  `3-leg flex (joint-simulation): P(all win) 9.6%, expected return 0.5542×
  (payout pp-default-2026.1)`, downside 63.3%; sources + no-guarantee warnings.
- **Live MLB:** `scripts/verify-data.ts` — LIVE DATA PIPELINE OK ✅ (2026).
- **E2E:** `scripts/shoot-chat.mjs` Playwright smoke (dev) — passed previously.

## Next action

Rebase onto latest `origin/main`, push, PR base `main`, CI green, merge,
post-merge proof, final reports.

## External blocker

None.

## Known limitations (unbuilt; documented, not stubbed)

Dedicated point-in-time player-profile module; full sensitivity-analysis engine
(assessment consumes a fragility score but a dedicated per-assumption sweep is
not built); Entry Analyzer / backtesting dashboard **UI** (engines ship + tested,
no pages); persistent DB + migrations (in-memory/localStorage today; interfaces
DB-ready); cross-entity (pitcher↔opposing-hitters) correlation; reviewed-image
import. See `FEATURE_INVENTORY.md`.
