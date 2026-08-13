# Consolidation audit — PR #32 → latest

Reconciles all intended Diamond Edge work from PR #32 through #36. Based on **code
inspection of the actual git tree**, not PR descriptions (PR #32's description said
"documentation-only" but its changed-file list is application code — descriptions
were NOT trusted).

## PR history (verified against the git tree)

| PR | Branch | Head | Feature | Merged to main? |
|----|--------|------|---------|-----------------|
| #32 | `claude/init-4yrc0a` | `11a2799` | PrizePicks **Screenshot import** (reviewed image + parser + alt lines + PP history) | **NO** — open, never merged |
| #33 | `feature/player-picks` | `4f42b52` | Player Picks (`/picks`) | YES (`4f42b52`) |
| #34 | `feature/player-picks-polish` | `2589ce2` | Detailed Player Picks (deep panel) | YES (`2589ce2`) |
| #35 | `feature/player-performance` | `945a865` | Two-layer Player Picks (performance without a line) | YES (`945a865`) |
| #36 | `feature/pitcher-usage-joint-simulation` | `e756490` | Pitcher usage + removal hazard + joint start simulation | **NO** — open |

Main at consolidation start = `945a865` (has #33/#34/#35; **missing** #32 and #36).

## Feature matrix

| Feature | PR | main status | Action |
|---------|----|-------------|--------|
| Manual import | pre-#32 | PRESENT | KEEP |
| CSV import | pre-#32 | PRESENT | KEEP |
| **Screenshot import tab** | #32 | **MISSING** (branch only) | **PORTED** (cherry-pick `11a2799`) |
| Screenshot parser (`screenshot.ts`) | #32 | MISSING | PORTED |
| Alt lines (goblin/standard/demon = one market) | #32 | MISSING | PORTED |
| PP source history / L5 avg metadata | #32 | MISSING | PORTED |
| `evaluate.ts` alt-line probs from one distribution | #32 | MISSING | PORTED |
| Player Picks (`/picks`) | #33 | PRESENT | KEEP |
| Detailed deep panel | #34 | PRESENT | KEEP |
| Two-layer (performance + opportunities) | #35 | PRESENT | KEEP |
| Pitcher usage / removal / joint sim | #36 | NOT MERGED | INTEGRATED (branch reused) |
| Pitcher usage in Player Picks | #36 | NOT MERGED | INTEGRATED |
| Alt lines → Player Picks (imported) | #32+#33 | broken (field dropped) | **RECONCILED** (`linesForPlayer` re-maps `alternativeLines`) |

## What "screenshot import" actually is (honest classification)

**UPLOAD + PREVIEW + TEXT REVIEW IMPORT** — the user uploads screenshot(s) (kept as
visual provenance) and reviews/edits the transcribed text, which a deterministic
parser (`screenshot.ts`) turns into normalized entries. It is **not** automatic
vision OCR; no vision-extraction provider exists in the repo, so none is claimed.
The `reviewed-image-import` source type + `screenshotProvider` land in the SAME
existing pipeline (`buildBoardEntry` → resolver → market-map → board → runAnalysis).
No brittle fake OCR, no fabricated parsed values.

## #32 ↔ #36 integration (verified)

Imported pitcher lines for the same player/game are evaluated from ONE joint
pitcher-start simulation: `runAnalysis` memoizes the joint sim per
`(playerId, season, log-snapshot)`, so K/H/BB/HR/ER/Outs lines (and their
goblin/standard/demon alternatives via `analyzeAltLines` /
`probsFromDistribution`) all read the same distribution — a market line never
re-projects the pitcher. Screenshot alt lines flow board → `linesForPlayer` →
picks API → orchestrator → same distribution.

## Intentionally NOT ported

- The separate #32 CLAUDE.md commit (`82b0990`, Reddit research docs) — unrelated
  to the screenshot feature and already reflected elsewhere; not part of this
  consolidation.

## Regressions found / fixed

- **Imported alternative lines were dropped** at the Player Picks boundary
  (`linesForPlayer` omitted `alternativeLines` because main's board-entry type
  lacked the field). Fixed by porting the #32 type + re-mapping the field.

## Gates at consolidation

typecheck ✓ · lint ✓ · `bun test src` 740 pass / 0 fail · build ✓.
