# Target Architecture

## Goal

Keep the **pure analytics core** exactly as-is and wrap all orchestration in a
small, typed **graph workflow engine** with independent verification,
runtime-validated contracts, structured observability, and time-aware evaluation.

## Layers & allowed dependency direction

```
             ┌─────────────────────────────────────────────┐
   UI  ─────▶│ route handlers (app/api)                     │
             │   validate request → run ONE workflow → map  │
             └───────────────┬─────────────────────────────┘
                             ▼
             ┌─────────────────────────────────────────────┐
             │ application WORKFLOWS (src/workflows/*)       │
             │   graph nodes compose the core + adapters     │
             └───────┬───────────────────────┬──────────────┘
                     ▼                        ▼
        ┌────────────────────┐    ┌───────────────────────────┐
        │ DOMAIN / CORE      │    │ DATA ADAPTERS             │
        │ math, analytics,   │◀───│ mlb/providers/supabase    │
        │ odds, prediction,  │    │ (implement domain ifaces) │
        │ props (PURE)       │    └───────────────────────────┘
        └────────────────────┘
                     ▲
        ┌────────────────────┐   ┌───────────────────────────┐
        │ SCHEMAS (Zod)      │   │ GRAPH ENGINE + OBSERVABILITY│
        │ src/schemas/*      │   │ src/workflows/graph, src/observability
        └────────────────────┘   └───────────────────────────┘
```

**Rules (enforced by review, see AGENTS.md):**

- `domain/core` imports nothing from Next.js, React, route handlers, UI, or
  concrete external clients.
- `graph engine` and `schemas` import nothing from adapters or UI (they are
  foundational). Adapters and workflows may import them.
- Data adapters implement **domain interfaces**; workflows receive adapter
  functions by injection, not by importing concrete clients directly.
- Route handlers are thin: validate request → run one workflow → map typed result
  → consistent envelope. No business math in handlers or React components.

## The ten layers (mission Phase 2) → where they live

| # | Layer | Location |
| --- | --- | --- |
| 1 | Domain | `src/lib/{math,analytics,odds,props,prediction,domain}` (kept) |
| 2 | Data-source adapters | `src/lib/{mlb,providers,supabase}` (kept) |
| 3 | Repository interfaces | `src/schemas` contracts + injected adapter fns (documented seam) |
| 4 | Graph workflow engine | `src/workflows/graph` |
| 5 | Workflow nodes | `src/workflows/<name>/nodes` |
| 6 | Validation schemas | `src/schemas` |
| 7 | Verification nodes | `src/workflows/verification` |
| 8 | Observability | `src/observability` |
| 9 | Evaluation & backtesting | `src/lib/backtest` (kept) + EVALUATION_STRATEGY |
| 10 | UI presentation | `src/app`, `src/components`, `src/features/*/components` |

## Migration posture

The pure core and every existing feature are preserved. The graph engine wraps
`runAnalysis`'s pipeline as the first real workflow, exposed behind the existing
analysis route as an opt-in so default behavior is unchanged. Remaining workflows
and the physical `lib → core/data` move are documented follow-ons
(see `docs/audit/MIGRATION_PLAN.md`).
