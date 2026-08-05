# Dependency Map — Audit (Phase 1)

## Intended vs actual direction

Target (and mostly honored today):

```
UI (app, components, features/*/components)
   ↓ fetch
route handlers (app/api)
   ↓ call
orchestrators (lib/mlb/analysis, lib/mlb/slate, lib/prizepicks/*, features/chat/server)
   ↓ use
pure core (lib/math, lib/analytics, lib/odds, lib/props, lib/prediction/{projection,simulate,engine})
   ↑ interfaces
data adapters (lib/providers/*, lib/mlb/{client,api}, lib/supabase/*)
```

## Pure-core import boundary (verified)

`lib/math`, `lib/analytics`, `lib/odds`, `lib/prediction/{projection,simulate,
engine,paSim,quality,adjustments}`, `lib/props`, `lib/backtest`,
`lib/prizepicks/decision/{types,veto,evaluate-*,policy,version,sensitivity}` and
`lib/prizepicks/entry/*` do **not** import `next`, `react`, route handlers, UI, or
concrete network clients. This boundary is real and is the foundation the target
architecture builds on.

Confirmable with:

```bash
# should print nothing
grep -rlE "from \"(next|react|@/app|@/components)" \
  src/lib/math src/lib/analytics src/lib/odds src/lib/prediction \
  src/lib/props src/lib/backtest
```

## Boundary leaks / risks

| Concern | Location | Notes |
| --- | --- | --- |
| Orchestrator knows adapters concretely | `lib/mlb/analysis.ts` imports `providers/statcast`, `providers/park`, `mlb/api` directly | No repository interface seam; hard to mock/swap without touching the orchestrator. |
| Server store imports network client | `lib/prizepicks/decision/store.ts` → `supabase/server` (static) | Guarded (server-only, service-role gated); acceptable but couples store to a concrete client. |
| UI imports domain types across many modules | `app/**`, `components/**` import from `lib/**` | Type-only in most cases (erased), but a few client components import runtime helpers. |
| Barrel re-exports | `lib/providers/index.ts`, `features/chat/tools/index.ts`, `lib/prizepicks/decision/index.ts` | No cycles found, but broad barrels are a latent cycle risk as the graph layer lands. |

## Circular dependencies

No hard cycles were found among the pure-core modules or between core and adapters
in a spot check. The main **latent** cycle risk is barrel files (`index.ts`
re-export hubs) combined with new cross-cutting layers (graph, observability). The
target architecture mandates: **the graph engine and schemas must not import any
adapter or UI; adapters and workflows may import the graph engine and schemas.**

## External dependencies

Runtime: `next`, `react`, `react-dom`, `@tanstack/react-query`, `recharts`,
`zod`, `date-fns`, `next-themes`, `motion`, `lucide-react`, `clsx`,
`tailwind-merge`, `class-variance-authority`, `@supabase/supabase-js`.
Dev: `typescript`, `eslint`, `eslint-config-next`, `tailwindcss`,
`@tailwindcss/postcss`, `playwright`, `@types/*`.

Observations:
- **No dedicated workflow/graph library** — good; the audit does not justify adding
  one. A ~small internal engine (typed, Zod-bounded) is the correct choice.
- Zod is already a dependency → contracts add no new runtime dependency.
- External network surfaces: `statsapi.mlb.com`, `baseballsavant.mlb.com` (keyless),
  Supabase (keyed, server-only). No paid odds feed (prices are user inputs).
