<!-- BEGIN:nextjs-agent-rules -->
# This is NOT the Next.js you know

This version has breaking changes — APIs, conventions, and file structure may all differ from your training data. Read the relevant guide in `node_modules/next/dist/docs/` before writing any code. Heed deprecation notices.
<!-- END:nextjs-agent-rules -->

# MLB data conventions

- **Never hard-code a season year.** The active season is resolved from the date
  in `src/lib/mlb/season.ts` (`getCurrentMlbSeason()` / `getMlbSeasonForDate(date)`).
  Use it for any `season` default. A historical request must resolve to the
  season that date belonged to — data created after a game must never feed a
  pregame projection.
- **Zero ≠ unavailable.** Missing MLB/Savant values stay `undefined` and are
  reported as unavailable; do not coerce them to 0.
- **Confirmed vs. projected.** Lineups inferred from a team's most recent game
  are `projected`, never presented as confirmed. Resolve players by MLB player
  ID, never by name alone.
- **Live vs. fixtures.** Do not describe a surface as live if it only runs on
  fixtures or manual imports (e.g. Tennis).
- Live/network scripts (`scripts/verify-*.ts`) run under Node/tsx, not Bun; the
  Bun unit suite (`bun test src`) must stay deterministic and offline.

# Architecture & graph workflows (2026-08 restructuring)

The analytics core is pure and untouched; orchestration is moving onto a small
internal **graph workflow engine**. Full design: `docs/architecture/`, audit:
`docs/audit/`, workflow guide: `docs/WORKFLOWS.md`.

- **Dependency direction:** UI → route handlers → workflows → domain/core;
  adapters → domain interfaces. The pure core (`lib/math|analytics|odds|props|
  prediction`), the graph engine (`src/workflows/graph`), and the contracts
  (`src/schemas`) import nothing from Next.js, React, route handlers, UI, or
  concrete external clients.
- **Graph engine (`src/workflows/graph`):** typed nodes with input/output Zod
  schemas, dependsOn, timeout, retry, failure policy, cost category; the executor
  gives topological ordering, bounded fan-out/fan-in, conditional routing (node
  guards), retry-with-backoff, per-node timeout, execution budgets, cancellation,
  and a full trace. Nodes return typed `Result` — errors are values, never thrown
  across boundaries.
- **Verification (`src/workflows/verification`):** deterministic, independent
  checks; a verifier never asks the production function whether it is right.
- **Observability (`src/observability`):** structured JSON logger (redacts
  secrets) + `WorkflowTrace`.
- **First migrated workflow:** player-prop (`src/workflows/player-prop`), exposed
  opt-in at `GET /api/players/[id]/analysis?engine=graph`; the default payload is
  unchanged.

## Commands

`pnpm dev` · `pnpm build` · `pnpm lint` · `pnpm typecheck` · `pnpm test:all` ·
`pnpm test:unit` · `pnpm test:contracts` · `pnpm test:workflows` ·
`pnpm test:statistical` · `pnpm verify` (lint + typecheck + tests + build).

## Specialized agents (`.claude/agents/`)

architect · mlb-data-agent · statistics-agent · workflow-agent · frontend-agent ·
test-agent · review-agent · security-agent. Each has a narrow responsibility. The
implementation agent never approves its own work — the review agent verifies diffs,
tests, architecture rules, and regressions independently.
