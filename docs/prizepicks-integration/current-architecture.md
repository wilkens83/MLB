# Phase 0 — repository audit (current architecture)

## Runtime & deployment
- **Next.js 16 (App Router), server runtime** (not static export). Route handlers
  under `src/app/api/**` run on Node (`runtime = "nodejs"`, `force-dynamic`).
- No database is provisioned. No auth. No env-var secrets required (MLB Stats API
  and Baseball Savant are public/keyless).
- Sandbox networking uses a TLS-intercepting proxy; the server honors it via
  `NODE_EXTRA_CA_CERTS`. Production has no such proxy.

## Existing routes (pages)
`/`, `/analyze`, `/slate`, `/games`, `/games/[gamePk]`, `/players`,
`/players/[id]`, `/players/[id]/analysis`, `/health`.

## Existing API routes
`/api/slate`, `/api/games`, `/api/market/game`, `/api/players/[id]/analysis`,
`/api/players/[id]/{gamelog,splits,arsenal}`, `/api/players/search`,
`/api/health`, `/api/cache`, `/api/headshot/[id]`, `/api/team-logo/[id]`.

## Domain types
- Players/games/lineups: `src/lib/domain/models.ts`, `src/lib/mlb/types.ts`.
- Real **MLB player IDs are available** everywhere (search, slate, game logs,
  headshots via `/api/headshot/[id]`).

## Supported prop identifiers (canonical, in `props/catalog.ts`)
Pitcher: `strikeouts`, `pitcher_outs`, `earned_runs`, `hits_allowed`,
`pitcher_walks`, `home_runs_allowed`.
Hitter: `hits`, `singles`, `doubles`, `triples`, `home_runs`, `total_bases`,
`runs`, `rbis`, `hits_runs_rbis`, `walks`, `batter_strikeouts`, `steals`,
`fantasy_points`.
Team/game (not player props): `first_inning_runs`, `rfi`, `nrfi`, `team_hits`,
`team_total`, `moneyline`, `spread`, `total_runs`.

## Model outputs (per `runAnalysis`)
`projection.lambda`, `simulation.{mean,median,probOver,probUnder,probPush,ci80,
ci95,distribution}`, `analytics.hitRates` (L5–L30/season), `recommendation`
(edge/EV/Kelly/confidence), `dataQuality`, `warnings`, `provenance`
(modelVersion, seed, sources).

## Persistence & cache today
- In-memory TTL cache in `mlb/client.ts` + Savant client; no durable store.
- Client state via React Query + a localStorage workspace (`/analyze`).

## Audit conclusions

**1. Reusable unchanged:** the whole analytics core, `runAnalysis`, player
search, slate/game resolution, headshot/logo proxies, `PlayerAvatar`, badges,
charts. The PrizePicks line maps directly to the `line` argument of `runAnalysis`.

**2. Adapters required:** board domain types + Zod; market-label → canonical prop
map; player-name normalization + resolver (over MLB search + slate); CSV parser;
ranking/signal; result grading; a persistence store.

**3. Persistence gap:** no DB. **Chosen baseline: browser `localStorage`**
(append-only line snapshots, immutable pregame snapshots) behind a small store
interface, so a server DB (SQLite/Postgres/Supabase) can replace it later without
touching callers. Rationale in `method-comparison.md`.

**4. Cannot implement without external access / out of honest scope this pass:**
automated PrizePicks retrieval (terms/anti-bot — see method comparison); OCR
screenshot extraction (kept as a manual-review stub); auto result-grading cron;
backtesting/calibration dashboards (grading + ranking *logic* is built + tested).

**5. Integration risks:** player-name ambiguity (mitigated by required review),
doubleheader game resolution (flagged, never auto-picked), stale imported lines
(timestamped + staleness badges), market mislabeling (canonical map + review
queue, strict hitter/pitcher-K disambiguation).
