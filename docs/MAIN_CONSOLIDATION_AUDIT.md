# Main Consolidation Audit

**Date:** 2026-07-31
**Baseline `origin/main`:** `6cdcd9fc9b1728ff557d5bcbc1a5a4a207c8b019`
**Integration branch:** `integration/consolidate-diamond-edge`

## Method

For every remote branch: `git rev-list --count origin/main..<branch>`,
`git diff --name-status origin/main..<branch>`, and content diffs on the files
that differ.

## Branch-by-branch decision

| Branch | Latest SHA | Merge-base | Ahead of main | Files only on branch | Decision | Reason |
|---|---|---|---|---|---|---|
| `origin/main` | 6cdcd9f | — | — | — | baseline | Already contains the consolidated app (MLB core, PrizePicks, Tennis, dynamic season, AI Data Chat). |
| `origin/feat/ai-data-chat` | 230dafb | 230dafb | 0 | none | **exclude (already integrated)** | Identical tree to main — merged via PR #6. |
| `origin/fix/mlb-api-2026-main-integration` | 94c3e8f | 94c3e8f | 0 | none | **exclude (already integrated)** | Strict subset of main — merged via PR #5 (dynamic season + bounded caches + CI). |
| `origin/claude/diamond-edge-tennis-continue-76wt7d` | 2c2a936 | c6d6a9f | 26 | **none** | **exclude (obsolete ancestor)** | Every file exists on main; its versions are older (e.g. still hard-codes `CURRENT_SEASON = 2026`, pre-dates the sport-tabs shell). main → branch is a net removal of ~5.3k lines. |
| `origin/claude/init-jbwu53` | 117eefd | c6d6a9f | 27 | **none** | **exclude (obsolete ancestor)** | Same as above; the pre-consolidation history main was rebuilt from. |
| `origin/claude/init-lix48b` | (init) | c6d6a9f | 24 | **none** | **exclude (obsolete ancestor)** | Oldest branch — lacks the tennis-shell integration and season resolver that main already has. |

### Key proof

`git diff --name-status origin/main..<branch>` shows **no `A` (added) files** for
any branch — i.e. **no file exists on any branch that `main` does not already
have.** All differences are `M` (modified) files whose branch versions are the
*older* pre-PR#5/#6 code (verified by diffing `src/lib/mlb/api.ts`,
`src/components/shell/app-shell.tsx`, etc.). Therefore:

> **No valid functionality remains only on another branch. `origin/main` is a
> strict superset of every remote branch.** The git-level consolidation is
> complete; there is nothing to integrate from the other branches — only
> obsolete duplication to exclude.

## Consequence for this consolidation PR

Because main already absorbs every branch, this branch does **not** cherry-pick
or merge other branches (that would reintroduce obsolete code). Instead it:

1. Documents the audit + feature inventory (this file + `FEATURE_INVENTORY.md`).
2. Adds the highest-value features that are **absent from the entire repository**
   (not just from main) and align with the existing pure-engine architecture:
   correlation-aware PrizePicks **entry analysis** and a **backtesting metrics**
   engine over pregame snapshots + graded results — both pure, deterministic,
   and unit-tested, composed on the existing `paSim`/`evaluate`/`grading` code.
3. Leaves genuinely-unbuilt, larger subsystems documented as known limitations
   (see `FEATURE_INVENTORY.md`) rather than shipping unverified stubs.

No branches are deleted (per the non-negotiable rules).
