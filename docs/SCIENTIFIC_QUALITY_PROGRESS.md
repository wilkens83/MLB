# Scientific-Quality Upgrade — Progress & Report

Goal: make Diamond Edge a **scientifically auditable** decision-support system —
point-in-time provenance, chronological validation against naive baselines,
distribution-drift monitoring, a full model-lifecycle gate, and scientific
circuit breakers — **without duplicating** any existing engine. Every change
extends a canonical module in place.

- **Base `main` SHA:** `301760644e44812f8de58ee2c5e909f6b8794af4`
- **Integration branch:** `integration/scientific-quality`
- **Status:** complete (pending PR merge into `main`).

## What changed (all in-place extensions of existing modules)

### Decision provenance & taxonomy (`src/lib/prizepicks/decision/`)
- **Entry taxonomy fixed.** A complete, possibly mixed-direction entry is now
  `APPROVE_ENTRY` — never mislabeled `BET_MORE` because it happens to contain a
  More leg. Legs keep the directional `BET_MORE` / `BET_LESS`; the entry-level
  states are `APPROVE_ENTRY / WAIT / NO_BET / UNAVAILABLE`
  (`types.ts` `entryDecisionSchema`, `anyDecisionSchema`). A Zod `superRefine`
  enforces the invariant: a LEG can never be `APPROVE_ENTRY` and an ENTRY can
  never be a directional BET.
- **Full model-lifecycle gate.** `marketValidationStateSchema` now carries all
  nine lifecycle states (`DEVELOPMENT`, `BACKTEST_ONLY`, `SHADOW`,
  `RESEARCH_ONLY`, `PROVISIONAL`, `VALIDATED`, `PRODUCTION`, `SUSPENDED`,
  `RETIRED`). `isBetEligibleState()` is the single source of truth: only
  `VALIDATED` / `PRODUCTION` may produce a firm BET, and `PROVISIONAL` only when
  the policy sets `allowProvisionalMarkets`. Every other state emits a blocking
  veto (`MARKET_SUSPENDED` / `MARKET_RESEARCH_ONLY` / `MARKET_NOT_ELIGIBLE`).
- **Scientific circuit breakers** (`veto.ts`): a degraded-calibration,
  feature-drift-exceeded, or outside-training-support signal forces `NO_BET`; a
  missing required simulation dependency forces `UNAVAILABLE`. All route through
  the mandatory veto engine, so a tripped breaker makes a firm BET impossible.
- **Payout-integrity gate.** A generic (unverified) default payout table can no
  longer back a firm decision: `payoutVerified === false` emits a
  `PAYOUT_UNVERIFIED` veto → `NO_BET`. `from-board.ts` marks board-derived
  payouts unverified by default.
- **Reproducibility provenance.** Every `DecisionResult` now carries
  `eventStartTime` (the point-in-time leakage boundary), `payoutVerified`, and an
  `inputHash` over the exact decision inputs, alongside the existing
  policy/model/payout versions and `configChecksum`.

### Chronological validation (`src/lib/backtest/`)
- **Baseline comparison** (`metrics.ts` `compareToBaselines`): scores the model's
  `probWin` against a coin-flip, a shrink-to-0.5, and any per-snapshot
  `baselineProbWin` on the **same** graded, non-leaked, non-push pairs (Brier +
  log loss, lower is better). A sophisticated model that cannot beat these
  naive baselines is not validated — the comparison makes that visible.
- **Distribution-drift monitoring** (`drift.ts`, new — no equivalent existed):
  Population Stability Index with `classifyDrift` (stable < 0.1 ≤ moderate <
  0.25 ≤ significant) and `assessDrift` producing the breach signal that feeds
  the decision engine's drift circuit breaker. Empty samples return 0 rather
  than throwing.
- The existing temporal-leakage guard (feature cutoff after game start → excluded)
  is honored by both the backtest report and the baseline comparison.

### UI / chat surfacing
- `/decisions` renders `APPROVE_ENTRY` (positive style, "APPROVE ENTRY" label,
  check icon).
- Chat response builder treats `APPROVE_ENTRY` as a bettable outcome for tone.

## Non-duplication ledger

| Need | Canonical module extended | New file? |
| --- | --- | --- |
| Entry taxonomy / lifecycle / provenance | `decision/types.ts` | no |
| Lifecycle + circuit-breaker vetoes | `decision/veto.ts`, `reasons.ts` | no |
| Payout-verification & entry state | `decision/evaluate-entry.ts` | no |
| Policy toggle | `decision/policy.ts` | no |
| Baseline comparison | `backtest/metrics.ts` | no |
| Input-distribution drift (PSI) | — (nothing scored input drift) | **yes: `backtest/drift.ts`** |

Only one new file was added, and only because no module scored input-distribution
drift (the backtest engine scores calibration/accuracy of outcomes, not input
shift). No `*-v2` / `-new` / parallel engine was created; no database or Python
layer was introduced.

## Validation (executed on the integration branch)

- **Lint:** `pnpm lint` — clean (exit 0).
- **TypeScript:** `pnpm exec tsc --noEmit` — clean (exit 0).
- **Unit tests:** `bun test src` — **352 passed, 0 failed** (30 files).
  New/extended coverage: `backtest/drift.test.ts` (PSI thresholds, breach,
  empty-input guard); `backtest/metrics.test.ts` (`compareToBaselines` beats
  coin-flip, provided-baseline series, leakage/push exclusion); `decision.test.ts`
  (APPROVE_ENTRY for mixed direction, payout-unverified → NO_BET, four circuit
  breakers, nine-state lifecycle gating incl. PROVISIONAL-by-policy, inputHash).
- **Build:** `pnpm build` — success.

## Known limitations

- Circuit-breaker inputs (calibration/drift/support flags) and
  `marketValidationState` are supplied to the engine as facts; wiring live PSI
  and forward-graded calibration into those flags is the next integration step.
- Live firm BET remains rare by design: data quality ≥ 85 and lifecycle
  `VALIDATED`/`PRODUCTION` are required, and markets default to `RESEARCH_ONLY`
  until forward-graded results exist.
- Persistence remains in-memory (interface DB-ready), unchanged by this mission.

---

# Supabase Scientific Persistence (follow-on)

- **Integration branch:** `integration/supabase-scientific-persistence`
- **Connected project:** `mlb-edge` (ref `jjrnimrljknyrvkyszih`, region `us-east-1`,
  Postgres 17). This is the **only** project on the account and is treated as the
  **development / single** environment. No new project was created; the existing
  one was reused (it was paused/INACTIVE and was restored — a non-destructive
  unpause — to work with it). Secrets are never committed: the app reads
  `NEXT_PUBLIC_SUPABASE_URL`, `NEXT_PUBLIC_SUPABASE_ANON_KEY` and the server-only
  `SUPABASE_SERVICE_ROLE_KEY` from the environment (see `.env.example`).

## Discovery — what already existed

The database was **not** empty. It carried a legacy user-facing schema predating
this repo's Supabase integration (applied out-of-band; 6 migrations
`20260523`–`20260525` recorded in `supabase_migrations.schema_migrations`, none
present in the repo): `predictions`, `bets`, `odds`, `api_cache`, `players`,
`teams`, `user_settings`. Every one is **user-owned** (`auth.uid() = user_id`)
and **mutable** (settled/actual updated in place), so none is compatible with the
append-only, server-authoritative scientific contract. RLS conventions observed:
reference tables (`players`/`teams`/`api_cache`) are `authenticated SELECT true`;
user tables are keyed on `auth.uid()`. This work does **not** touch any legacy
table, policy, function, or migration.

## Database mapping report

| Scientific concept | Existing Supabase object | Status | Action |
| --- | --- | --- | --- |
| raw_observations | `api_cache` (TTL cache, key/payload/expiry) | INCOMPATIBLE (not point-in-time, no available_at, mutable) | CREATE |
| prizepicks_line_snapshots | localStorage board snapshots (`prizepicks/store.ts`); no table | ABSENT | CREATE (+ Supabase adapter) |
| payout_snapshots | `PrizePicksPayoutTable` (code only) | ABSENT | CREATE |
| feature_snapshots | none | ABSENT | CREATE |
| projection_snapshots | `predictions` (user-owned, mutable, no provenance) | PARTIAL / INCOMPATIBLE | CREATE (reuse `PregameSnapshot`/`CandidateEvaluation` models) |
| decision_snapshots | `bets` (user-owned, odds/kelly, mutable) + in-memory `DecisionStore` | PARTIAL / INCOMPATIBLE | CREATE (SupabaseDecisionStore behind the existing interface) |
| official_results | none | ABSENT | CREATE |
| grading_history | `gradeResult()` mutating `predictions.settled` | ABSENT (as separate table) | CREATE (append-only, separated from the decision) |
| model_registry | `MarketValidationState` enum (code only) | ABSENT | CREATE (DB is now the trusted lifecycle source) |
| market_validation_metrics | `computeBacktest()`/`compareToBaselines()` (compute only) | ABSENT | CREATE |
| drift_reports | `assessDrift()` PSI (compute only) | ABSENT | CREATE |
| circuit_breaker_events | veto engine (compute only) | ABSENT | CREATE |

Net: all twelve scientific entities are **new** tables. The pre-existing
`predictions`/`bets`/`odds`/`api_cache` tables are loosely related but user-owned
and mutable; overloading them would violate the append-only + server-authoritative
contract, so they are kept as-is and the scientific tables sit alongside them.

## Migrations (additive only)

- `20260804000000_scientific_persistence.sql` — the 12 tables, indexes, FK
  traceability, check constraints (incl. `available_at >= effective_at`,
  `data_as_of <= feature_cutoff`, `feature_cutoff <= event_start_time`, and the
  leg/entry decision-taxonomy invariant), append-only + breaker-resolve-only
  triggers, and RLS.
- `20260804000100_harden_function_search_path.sql` — pins `search_path=''` on the
  trigger functions (security advisor fix).
- `20260804000200_decision_result_blob.sql` — adds `decision_snapshots.result`
  jsonb so the immutable store round-trips its content-hash losslessly.

All three were applied to the connected project via the Supabase migration
workflow; `database.types.ts` is regenerated from the live schema.

## Security / RLS

- **System scientific tables** (raw/payout/feature/projection/decision/official/
  grading/registry/metrics/drift/breaker): RLS on, `authenticated SELECT` only,
  **no client write policy** — inserts happen only through the service role on the
  server. A browser therefore cannot create official results, set a validated
  model state, mark a payout verified, alter metrics, resolve breakers, or supply
  drift/calibration flags.
- **prizepicks_line_snapshots**: a user may `INSERT`/`SELECT` their own rows, and
  the insert policy forces `is_verified = false` (a client can never self-verify).
- **Append-only**: triggers block `UPDATE`/`DELETE` on immutable tables for every
  role (service role included); corrections append a new row (`supersedes_id`,
  `version`, `previous_grade`). Circuit breakers allow updating only their
  resolution columns.

## Adapters + server-derived facts

- `SupabaseDecisionStore` implements the existing `DecisionStore` interface;
  `getDecisionStore()` selects it when `SUPABASE_SERVICE_ROLE_KEY` is set, else the
  in-memory baseline (tests / keyless dev). Grading appends to `grading_history`
  and never mutates the decision.
- Trusted repositories (`src/lib/supabase/scientific.ts`) route every scientific
  write through the service-role client; `observationsAvailableAt` enforces the
  point-in-time rule (`available_at <= feature_cutoff`).
- `deriveMarketFacts` / `deriveEntryPayoutVerified` (`derive-facts.ts`) compute
  `marketValidationState`, `payoutVerified`, `calibrationDegraded` and
  `featureDriftExceeded` from the persisted registry + metrics + drift + verified
  payout — **never** from the request. The client-controllable
  `assumeValidatedMarkets` flag was removed from the API route, chat tool, and
  decisions page. With no database these degrade to the conservative defaults
  (RESEARCH_ONLY, unverified), so a keyless deployment can never emit a firm BET.

## PSI correction

Empty or below-`MIN_DRIFT_SAMPLE` samples now resolve to `insufficient_data` — a
**breach** that blocks firm approval — instead of "stable". Category-share PSI is
used for binary/categorical/low-cardinality-discrete features; decile PSI only for
continuous ones. Persisted via `drift_reports.insufficient_data` + the
`insufficient_data` drift level.

## Runtime validation (executed against the connected dev project)

Tagged (`__e2e*`) records were inserted through the **full line→grade pipeline**
(model → line → raw observations → feature → projection → verified payout →
decision(APPROVE_ENTRY) → circuit-breaker event → official result → grading →
metrics → drift) with every FK chain intact, then removed via the privileged
`TRUNCATE` cleanup (the immutable tables reject `DELETE` by design; the tables
held no production data). Proven live:

- **Point-in-time:** 1 of 2 observations usable at the cutoff (the post-cutoff
  row is excluded as leakage).
- **Append-only:** a decision `UPDATE` is rejected; breaker evidence is immutable;
  only breaker resolution columns update (status → RESOLVED).
- **RLS:** an `authenticated` (non-service) role is blocked from inserting a
  decision and from registering a VALIDATED model.
- **Advisors:** no security lints on the new objects after the search_path fix
  (the pre-existing `auth_leaked_password_protection` advisory is a project-level
  auth setting, out of scope for this schema work).

## Validation

`pnpm lint` clean · `pnpm exec tsc --noEmit` clean · `bun test src` **368 pass /
0 fail** (32 files) · `pnpm build` success · runtime pipeline + RLS + point-in-time
verified live and cleaned up.

## Known limitations

- The MCP integration exposes only anon/publishable keys, so the running app in
  this sandbox cannot perform trusted writes; live application writes are enabled
  by setting the server-only `SUPABASE_SERVICE_ROLE_KEY` in the deployment
  environment. The database side (schema, RLS, append-only, the full pipeline) is
  validated live through the trusted SQL path; the application adapters are behind
  the existing interfaces and unit-tested with the in-memory fallback.
- Wiring live feature-support metadata into `outsideTrainingSupport` and streaming
  provider health into `requiredSimDependencyUnavailable` remain follow-ups.

---

## Tennis Live Provider Configuration Loop

Converting the inert Tennis live providers (Sportradar, SportsDataIO, API-Tennis)
into verified, graph-orchestrated adapters. Reuses the existing provider registry,
graph engine, verification layer, and Tennis domain — nothing is recreated.

```
goal:                    configure + verify the 3 Tennis live providers end-to-end
iteration:               1
branch:                  integration/tennis-live-providers  (based on origin/main,
                         which already contains the squash-merged graph architecture
                         PR #14 + Supabase persistence PR #13 — trees identical)
last_verified_commit:    (origin/main @ 85cf4cc)
current_provider:        all three (adapters + factory + workflow complete)
current_capability:      schedule/results/rankings/players wired + acquisition graph
last_successful_gate:    lint + typecheck + bun test src (456 pass / 0 fail) green
current_failure:         —
exact_failing_command:   —
exact_error:             —
root_cause:              —
attempts_on_root_cause:  0
official_documentation_checked:
  - API-Tennis: https://api-tennis.com/documentation (verbatim field names captured)
  - Sportradar Tennis v3: https://developer.sportradar.com/tennis (endpoints confirmed)
  - SportsDataIO Tennis: v3/tennis data dictionary (portal-gated; documented shape)
credential_status:       SPORTRADAR_TENNIS_API_KEY ABSENT · SPORTSDATAIO_TENNIS_API_KEY
                         ABSENT · API_TENNIS_API_KEY ABSENT
entitlement_status:      unknown (no credentials to probe)
live_mapping_verified:   NONE live-verifiable in this environment (no keys) — all live
                         verification is BLOCKED_CREDENTIAL by design; adapters are
                         built from official documented contracts + contract fixtures
tests_added:             +53 tests — http.test.ts (client), adapters.test.ts
                         (contract), credentialed.test.ts (factory lifecycle),
                         verify.test.ts (invariants), observations.test.ts
                         (point-in-time), workflow.test.ts (graph acquisition)
next_action:             validate (verify) → rebase on origin/main → PR → CI → merge
external_blocker:        Live verification of all three providers requires vendor API
                         keys (server-side) that are absent in this environment.
                         All live auth = BLOCKED_CREDENTIAL; no false READY exists.
```

### Provider success matrix (live verification)

| Provider | Auth | Schedule | Results | Rankings | Players | Historical |
|----------|------|----------|---------|----------|---------|------------|
| Sportradar   | BLOCKED_CREDENTIAL | contract-tested | contract-tested | contract-tested | contract-tested | contract-tested |
| SportsDataIO | BLOCKED_CREDENTIAL | contract-tested | contract-tested | contract-tested | contract-tested | UNSUPPORTED |
| API-Tennis   | BLOCKED_CREDENTIAL | contract-tested | contract-tested | contract-tested | contract-tested | UNSUPPORTED |

`contract-tested` = adapter built from official documented schema, exercised by
committed sanitized fixtures + malformed/missing-field rejection tests. Live auth
verification is blocked pending credentials — no provider is marked READY.

---

## Free Tennis Data + UI Loop

Make the Tennis section fully usable with NO paid API: free historical dataset
(Jeff Sackmann tennis-abstract schema, non-commercial license), manual current
matchup, and deterministic demo fixtures — all on the EXISTING provider layer,
graph engine, verification, and model. Paid providers stay optional.

```
iteration:                 1
branch:                    integration/free-tennis-data (from origin/main @ 43a62ce,
                           which now contains the merged live-provider work #16)
current_phase:             foundation — seed dataset + historical-free provider +
                           data-mode model + status/UI + free-data graph workflow
active_data_source:        curated Sackmann-schema sample (tennis_atp / tennis_wta)
dataset_version:           seed-2026.08 (curated sample; full-import path provided)
license_status:            data CC BY-NC-SA 4.0 — research/non-commercial (documented)
download_status:           seed bundled (no network at build/test); optional live import
normalization_status:      via parseHistoricalCsv + small players/rankings parsers
identity_resolution_status: reuse data/identity.ts (never name-alone)
provider_status:           historical-free READY (results/rankings/players/historical);
                           manual READY; demo-fixture READY; paid live UNCONFIGURED
graph_status:              tennis-free-data-acquisition@1 green (7 nodes, PASS verify,
                           24 observations mapped; REJECT→persist skipped; leakage guard)
supabase_status:           reuses raw_observations (sport=tennis via entity_type) +
                           dataset provenance/version/license; no schema change
ui_status:                 home shows Data Mode + availability + coverage/provenance (no
                           more "unavailable"); data-health shows modes + free dataset
                           provenance/coverage/license + all providers by mode
tests:                     +23 (freeDataset, mode, status regression, freeModelIntegration,
                           free-data workflow). 483 pass / 0 fail. lint+tsc+build green.
last_failure:              ATP/WTA match-id collision → verify REJECT (fixed: namespace
                           match id by tour); false DUPLICATE_RANK (fixed: key by tour+asOf)
root_cause:                resolved
attempts:                  2 (both resolved first pass)
next_action:               commit → PR → CI → merge → post-merge validation

REAL coverage (computed): ATP players 6 · WTA players 7 · ATP matches 7 · WTA
matches 5 · ranking observations 12 · matches with serve stats 11 · without 1 ·
years 2023–2024 · parse failures 0.
```

---

## PrizePicks Ingestion Loop

Improve PrizePicks board ingestion into validated canonical line snapshots via a
graph workflow (`prizepicks-import@1`), reusing the existing CSV parser, market
canonicalizer, player/game resolver, snapshot table, and graph engine — nothing
recreated.

```
iteration:        1
branch:           integration/prizepicks-ingestion (from origin/main @ 93a9c35)
pipeline:         loadInput→parseRows→normalizeMarkets→resolvePlayers→resolveGames
                  →validate→reviewGate→persistSnapshots
line states:      IMPORTED · NEEDS_REVIEW · VERIFIED · REJECTED (server-derived)
idempotency:      inputHash(boardDate,player,market,line,projectionType) → no-op dup
supersede:        changed line = new snapshot referencing the prior (never overwrite)
verification:     browser/import can never set VERIFIED — only a trusted reviewGate
persistence:      LineSnapshotStore (in-memory baseline + Supabase behind service key)
migration:        20260808120000_pp_line_verification_status.sql — additive columns
                  verification_status (4-state check) + player_name; no reset, no
                  legacy-table change; database.types.ts updated to match
routes:           POST /api/prizepicks/import (strips `reviews` → browser cannot
                  VERIFY) · GET /api/prizepicks/lines?date= (reload persisted)
tests:            +13 — snapshotStore (idempotent/supersede/no-overwrite/list) +
                  prizepicks-import@1 workflow (CSV import, invalid→REJECTED,
                  ambiguous→NEEDS_REVIEW, doubleheader→NEEDS_REVIEW, role-based
                  market, idempotent re-import, supersede on change, trusted-review
                  VERIFIED only on resolved lines, pre-parsed rows path)
result:           lint + tsc + build green; bun test src 496 pass / 0 fail
next_action:      PR → CI → merge → post-merge validation
```

---

## Opportunity Engine Loop

Build the Opportunity Engine on EXISTING projection/decision/backtest/graph infra
— no second model engine. Input: a verified CanonicalLineSnapshot. Output:
CanonicalOpportunityAssessment.

```
branch:        integration/opportunity-engine (from origin/main @ 1edea14, incl. #19)
graph:         prizepicks-opportunity@1 — resolveLine → loadPregameSnapshot →
               projection → independentBaseline → calibration → uncertainty →
               sensitivity → fragility → trustedScientificFacts → vetoes →
               opportunityDecision
reuse:         computeLegGates/evaluateLeg (veto+status), runSensitivity (fragility),
               poissonCdf (baselines), deriveMarketFacts (trusted facts), decision policy
new:           calibration layer (raw→calibrated, explicit UNAVAILABLE state),
               independent market baselines (pitcher K / outs / hitter hits / total bases),
               CanonicalOpportunityAssessment + status (UNAVAILABLE/NO_PLAY/WATCH/
               QUALIFIED_MORE/QUALIFIED_LESS)
rules:         raw ≠ displayed prob (prefer calibrated); calibration unavailable ⇒
               never QUALIFIED (degrade to WATCH); modelAdvantage = calibrated −
               INDEPENDENT baseline (never model-vs-itself); vetoes server-derived
tests:         +26 — opportunity engine (8 success gates: raw≠calibrated,
               unavailable-calibration/unvalidated-model/poor-DQ/high-fragility/
               stale-line block QUALIFIED, independent baseline, no-edge, veto
               non-override, thin-calibration UNAVAILABLE, version-referencing
               persistence) + graph workflow (11 nodes, QUALIFIED+persist, WATCH)
result:        lint + tsc + build green; bun test src 509 pass / 0 fail
next_action:   PR → CI → merge → post-merge validation
```

---

## Uncertainty & Fragility Loop

Extend the Opportunity Engine with rigorous uncertainty/sensitivity — no model
replacement; reuses runSensitivity's sim approach + the decision gates.

```
branch:  integration/uncertainty-fragility (from origin/main @ 19c7ac9, incl. #20)
new:     opportunity/uncertainty.ts (SEPARATED Monte-Carlo error / model-input
         uncertainty / data-missingness — never one merged "confidence"),
         opportunity/fragility.ts (configurable perturbation set + summarizer:
         baseProbability, scenarioProbabilities[], probabilityRange,
         medianScenarioProbability, directionFlipCount, fragilityScore,
         fragilityLevel LOW/MODERATE/HIGH/EXTREME — thresholds configurable)
rule:    scenarios repeatedly crossing 50% / reversing the preferred side ⇒
         directionUnstable ⇒ NEVER QUALIFIED (engine gate DIRECTION_UNSTABLE)
ui:      no "100% confidence"; show Data Completeness / Model Confidence /
         Calibration Support / Probability Range as distinct concepts
next:    build modules + engine gate + UI labels + tests
```
