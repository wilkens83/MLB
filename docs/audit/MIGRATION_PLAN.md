# Migration Plan (Phase 1 → incremental)

## Principle

Incremental, reviewable commits. **Preserve every working feature.** No big-bang
rename. Follow the closing directive's order:

> Contracts → minimal graph → one real workflow → tests → verification →
> observability → only then specialized agents.

## Delivered in this migration (vertical slice, verified)

1. **Audit + target-architecture docs** (`docs/audit/*`, `docs/architecture/*`).
2. **Data contracts** (`src/schemas/*`): Zod schemas for the domain + workflow
   boundary objects, additive (do not replace existing `lib/*/types`).
3. **Observability primitives** (`src/observability/*`): structured logger +
   trace collector (no secrets).
4. **Graph engine** (`src/workflows/graph/*`): typed nodes, edges, state, executor
   with retries/timeout/fan-out/fan-in/conditional/budget/cancellation, typed
   `Result`, trace collection.
5. **One real workflow** (`src/workflows/player-prop/*`): wraps the existing
   `runAnalysis` pure pipeline as graph nodes — game log → series → sample-quality
   → projection → simulation → price comparison → **independent verification** →
   recommendation. Reuses the pure core unchanged.
6. **Verification nodes** (`src/workflows/verification/*`): deterministic,
   independent checks (bounds, sample quality, simulation stability, cross-method
   agreement, freshness, odds math).
7. **Tests** (`test:unit`/`contracts`/`workflows` scripts): graph ordering,
   fan-out/in, retry, timeout, budget, conditional routing, contract rejection,
   verification, workflow happy + degraded paths — all offline with fixtures.
8. **Agents + docs + CI**: `.claude/agents/*`, tightened `AGENTS.md`/`CLAUDE.md`,
   `docs/WORKFLOWS.md` + friends, expanded test scripts + CI jobs.

The migrated workflow is wired **behind** the existing analysis route as an
opt-in (`?engine=graph`) so the current payload and every existing feature keep
working byte-for-byte by default. This satisfies "preserve working features while
proving the new architecture on one real vertical."

## Deferred (documented, not done here) — recommended next phases

| Order | Work | Why deferred |
| --- | --- | --- |
| 9 | Migrate slate + game-analysis + backtest + revalidation workflows to the graph. | Land after the pattern is proven on one vertical. |
| 10 | Physical `src/lib → src/core / src/data` move with temporary re-export shims. | High churn; do as its own PR to keep diffs reviewable. |
| 11 | Frontend feature-folder restructuring; loading/empty/error/insufficient states; chart a11y summaries; reduced-motion. | Cosmetic + structural; must not mix with core migration. |
| 12 | Shared response envelope applied to **all** routes. | Applied to the new path now; roll out per-route to avoid breaking clients. |
| 13 | Wire live calibration metrics to the UI. | Needs forward-graded sample. |

## Verification after each step

`pnpm lint` · `pnpm exec tsc --noEmit` · `bun test src` · `pnpm build` · inspect
`git diff` · report changed files. A step is not complete until all pass.
