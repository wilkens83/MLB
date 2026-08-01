# Main Consolidation — Final Report

## Result headlines

1. **Original `main` SHA:** `6cdcd9fc9b1728ff557d5bcbc1a5a4a207c8b019`
2. **Final `main` SHA:** `fcee24c6e2c9417b89fb3d2066205ff3e0fa095e`
3. **Pull request:** https://github.com/wilkens83/MLB/pull/7 (base `main` ← head `integration/consolidate-diamond-edge`)
4. **Merge commit SHA:** PR #7 was integrated via rebase-merge, so the tip
   `fcee24c` is the merged result (no distinct merge-commit SHA). It exists on
   `origin/main` (verified below).
5. **Integration branch:** `integration/consolidate-diamond-edge` (auto-deleted on
   the remote after merge).

## Branch audit

6. **Branches audited (5 remote, besides `main`):**
   `claude/diamond-edge-tennis-continue-76wt7d`, `claude/init-jbwu53`,
   `claude/init-lix48b`, `feat/ai-data-chat`, `fix/mlb-api-2026-main-integration`.
7. **Branches integrated:** none re-merged — **`main` was already a strict
   superset of all of them**. `feat/ai-data-chat` (PR #6) and
   `fix/mlb-api-2026-main-integration` (PR #5) were already merged; the three
   `claude/*` branches are obsolete ancestors (older versions of files main
   already has — e.g. hard-coded `CURRENT_SEASON = 2026`, no sport-tabs shell).
8. **Branches excluded and reasons:** all five — see the table in
   `MAIN_CONSOLIDATION_AUDIT.md`. Re-comparison **after** this work confirms
   `git diff --name-status origin/main..<branch>` reports **0 files that exist on
   any branch but not on `main`** for every branch. No valid functionality remains
   only on another branch. No branches were deleted.
9. **Commits integrated (this PR, 4):** correlation-aware entry engine; backtest
   metrics engine; chat `analyzeEntry` tool + wiring; consolidation docs.

## Features

10. **Features consolidated / present on `main`:** MLB Stats API + Statcast/Savant
    + pitch arsenal; dynamic season resolver; schedules/games/teams/players/
    rosters/splits/game-logs; projected-vs-confirmed lineups (MLBAM-id resolution,
    doubleheader-aware); projection + plate-appearance Monte Carlo; More/Less/Push
    + confidence + data-quality; Prop Explorer; PrizePicks Board (CSV/manual
    import, market map, evaluate, ranking, line + immutable pregame snapshots,
    grading); **correlation-aware entry analysis (new)**; **backtesting metrics
    engine (new)**; AI Data Chat (typed tools incl. `analyzeEntry`); Tennis;
    Data Health; CI. One application, no parallel apps or duplicate engines.
11. **Duplicate implementations removed:** none needed — no duplicate/parallel app
    or engine folders existed on `main`; the obsolete duplication lived only on
    the excluded ancestor branches and was never merged.
12. **Conflicts resolved:** none — the integration branch was based on the current
    `origin/main` and rebased cleanly (0 commits behind at push).

## Files & deps

13. **Files created:** `src/lib/prizepicks/entry/{jointSim,correlation,payout,entry,entry.test}.ts`,
    `src/lib/backtest/{metrics,metrics.test}.ts`,
    `src/features/chat/tools/prizepicks/analyze-entry.ts`,
    `src/lib/prediction/paSim.rates.test.ts`,
    `docs/{ARCHITECTURE,MAIN_CONSOLIDATION_AUDIT,FEATURE_INVENTORY,MAIN_CONSOLIDATION_FINAL_REPORT}.md`.
14. **Files modified:** `src/lib/prediction/paSim.ts` (pitcher allowed-rate +
    expected-BF estimators), `src/features/chat/tools/index.ts`,
    `src/features/chat/server/{intent,intent.test,response-builder}.ts`,
    `src/features/chat/llm/mock-provider.ts`, `CLAUDE.md`.
15. **Files removed:** none.
16. **Migrations added:** none (no SQL/migration layer exists yet — documented
    limitation; persistence interfaces are DB-ready).
17. **Dependencies changed:** none.

## Validation (executed on `main` after merge)

18. **Lint:** `pnpm lint` — clean (exit 0).
19. **TypeScript:** `pnpm exec tsc --noEmit` — clean (exit 0).
20. **Unit tests:** `bun test src` — **273 passed, 0 failed** (22 files, 2633
    assertions).
21. **E2E tests:** no configured Playwright test runner in the repo;
    `scripts/shoot-chat.mjs` (Playwright smoke) exercises `/chat` end-to-end and
    passed during development. Documented as the E2E surface.
22. **Build:** `pnpm build` — success.
23. **Live MLB:** `scripts/verify-data.ts` (Node/tsx) — LIVE DATA PIPELINE OK ✅
    (2026 season resolved dynamically).
24. **Routes manually tested (dev):** `/chat` (200) and `/api/chat` for pitcher-K
    rankings, follow-up filter, "why", player comparison, data-health, honest
    unsupported handling, and the new `analyzeEntry` on a real board (Skenes ×2 +
    Judge → same-pitcher K↔outs r=0.324, P(all win) 9.6%, flex payout 0.554×, with
    sources + no-guarantee/imported warnings). Existing routes unaffected.

## Unresolved limitations

25. Genuinely-unbuilt (never on any branch; documented, not stubbed): a dedicated
    point-in-time **player-profile module**; a **backtesting dashboard UI** (the
    metrics engine ships + is tested; no page); a **persistent DB + migrations**
    (in-memory/localStorage today, interfaces DB-ready); **cross-entity
    (pitcher↔opposing-hitters) correlation**; **reviewed-image PrizePicks import**.
    Earned-runs in the pitcher joint sim use a standard simplified bases-state
    model (all-earned, no DP/steals). See `FEATURE_INVENTORY.md`.

## Proof

26. **Final `git status` on `main`:** clean working tree.
27. **Proof the final SHA is on `origin/main`:**
    `git rev-parse origin/main` → `fcee24c6e2c9417b89fb3d2066205ff3e0fa095e`;
    `git branch -r --contains fcee24c` includes `origin/main`.

**Status: consolidation complete.** `origin/main` is the single coherent Diamond
Edge application; no valid functionality remains only on another branch.
