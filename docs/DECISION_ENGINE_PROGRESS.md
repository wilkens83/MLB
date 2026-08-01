# Firm Decision Engine — Progress

- **Current phase:** complete (pending PR merge into `main`).
- **Base `main` SHA:** `ddd57537154cfaa671c1c79ec9b406d623f21570`
- **Integration branch:** `integration/firm-decision-engine`

## Completed requirements

- Canonical decision engine (`src/lib/prizepicks/decision/`) with five FINAL
  states, strict precedence (UNAVAILABLE > WAIT > NO_BET > BET), a mandatory
  veto engine, versioned conservative policy, and Zod-validated `DecisionResult`.
- Leg vs. entry separation; firm BET only at the entry level with entry-EV gate.
- Real sensitivity sweep (`sensitivity.ts`) → base/worst/best probability +
  fragility; worst-case gate on firm BET.
- Market-validation gate (`market-validation.ts`): RESEARCH_ONLY / PROVISIONAL /
  VALIDATED / SUSPENDED controlling BET eligibility.
- Immutable decision audit trail (`store.ts`): append-only; new record on change;
  content-hash verified; grading additive.
- Chat tool `getEntryDecision` + `/api/prizepicks/decision` route (shared
  `from-board.ts` pipeline) returning the canonical decision; chat never
  overrides a veto or invents a decision.
- Decision Center UI (`/decisions`) rendering all five states with dominant
  decision, reasons, vetoes, per-leg cards, and WAIT release conditions; nav item.

## Validation (executed on the integration branch)

- **Failing command:** none.
- **Lint:** `pnpm lint` — clean (exit 0).
- **TypeScript:** `pnpm exec tsc --noEmit` — clean (exit 0).
- **Unit tests:** `bun test src` — **332 passed, 0 failed** (29 files; +38 decision).
- **Build:** `pnpm build` — success (`/decisions`, `/api/prizepicks/decision`).
- **Runtime (`/api/prizepicks/decision`, live 2026 data):**
  - power-2 research-only → **NO_BET** (ENTRY_EV_BELOW_MIN, EV 0.769×)
  - 2-leg flex → **WAIT** (flex needs 3+ legs → payout being configured)
  - hitter, unconfirmed lineup → **WAIT** (lineup veto; precedence over EV NO_BET)
  - unresolved player → **UNAVAILABLE**
  - BET_MORE/BET_LESS: produced by the engine (28 unit tests) + rendered by UI;
    live BET is rare because real pregame data quality is below the strict 85
    floor (intended conservatism).
- `/decisions` page → 200; chat "Should I bet this entry?" → firm decision via
  `getEntryDecision`. Existing MLB / PrizePicks / AI Chat / Tennis routes intact.

## Next action

Rebase onto latest `origin/main`, push, PR base `main`, CI green, merge,
post-merge proof, final report.

## External blocker

None.

## Known limitations

Live BET requires data quality ≥ 85 (rare pregame → conservative by design);
market validation defaults to RESEARCH_ONLY until forward-graded results exist;
persistence is in-memory (interface DB-ready); the sensitivity sweep covers the
material assumptions listed in the engine (not every possible axis).
