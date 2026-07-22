# Protected computational core — DO NOT modify for PrizePicks ingestion

The PrizePicks integration is an **adapter layer** that only *reads* the
existing engine. None of the files below may be changed to support ingestion.
If one ever must be touched, the change must be behavior-neutral, preserve all
outputs, and add regression tests (see the PR description for the audit).

## Protected files (analytics / providers / data / caching / tests)

| Area | Files |
|---|---|
| Math core | `src/lib/math/stats.ts` |
| Projection / simulation | `src/lib/prediction/projection.ts`, `simulate.ts`, `paSim.ts`, `engine.ts`, `adjustments.ts`, `quality.ts` |
| Analytics | `src/lib/analytics/hitRate.ts` |
| Odds math | `src/lib/odds/math.ts` |
| Props catalog | `src/lib/props/catalog.ts`, `src/lib/props/markets.ts` |
| MLB data | `src/lib/mlb/api.ts`, `client.ts`, `series.ts`, `context.ts`, `analysis.ts`, `slate.ts`, `market.ts`, `types.ts` |
| Providers | `src/lib/providers/*` (mlbStats, statcast, arsenal, park, health, savantClient, types, index) |
| Schemas/validation | `src/lib/schemas/*` |
| Domain models | `src/lib/domain/models.ts` |
| Existing tests | `src/lib/**/*.test.ts` (59 tests / 2100 assertions — must stay green) |

## How the adapter consumes the core (read-only)

- **Player search / games** → `src/lib/mlb/api.ts` `searchPlayers`, `getSchedule`, `getGame`.
- **Full candidate analysis** → `src/lib/mlb/analysis.ts` `runAnalysis(...)` (unchanged).
  The imported PrizePicks line is passed as the **threshold** (`line`) only. It is
  **never** fed back into the projection — the model does not move toward the line.
- **Prop identifiers** → the canonical keys already in `props/catalog.ts`.

## Invariant

The imported PrizePicks line is a *threshold for grading and probability*, not a
model input. `runAnalysis` receives it as `line`; the projection `λ` is computed
from real MLB/Statcast data exactly as before. Verified: identical projections
before/after this integration (see PR audit).
