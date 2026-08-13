# Full Project Reconsideration — Baseball-Causal-Correctness Audit

**Date:** 2026-08-13
**Base commit:** `8b9a48c` (post-consolidation `main`)
**Branch:** `feature/reconsideration-audit`
**Scope:** First-principles audit of whether Diamond Edge models the *baseball
causal process* — not merely the statistic — for every supported prop, plus the
single highest-impact verified correction.

This is a reconsideration, not a feature. It asks one question of every layer:
**does the code reproduce how the number is actually produced on a baseball
field?** Where the answer is "no," the finding is recorded with evidence, file,
and affected props. Where the answer is "yes, with a documented simplification,"
the limitation is stated honestly and scored on that honesty — a surfaced
limitation is not a defect.

---

## 1. The causal chain the code must honor

Every prop number is the end of a causal pipeline. The audit walks it end to
end and checks each link against the code that implements it.

```
IDENTITY      Resolve the player by MLBAM id, never by name.                    ─ lib/mlb, player-resolver
   ↓
ROLE          Starter vs reliever vs hitter — decides which engine runs.        ─ analysis.ts, catalog
   ↓
OPPORTUNITY   How many chances? Hitter → plate appearances; pitcher →           ─ paSim.expectedPasPerGame,
              batters faced / pitch budget.                                        workload.projectWorkloadBudget
   ↓
RATE          Per-chance event probabilities, shrunk to a league prior,         ─ estimatePaRates,
              adjusted for opponent/park/context. The calibrated core.             estimatePitcherRates, adjustPaRates
   ↓
EVENT         Draw each chance into a coherent event (a K is an out and not      ─ sampleOutcome (entry/jointSim)
              a hit; an HR is a hit; a walk is not a hit).
   ↓
GAME STATE    Advance base/out state so runs emerge from sequence, not from      ─ advance() bases-state model
              a marginal rate.
   ↓
REMOVAL       For a starter, an endogenous hook hazard ends the outing based     ─ removal.ts, jointSim loop
              on pitches/runs/baserunners/times-through-order.
   ↓
DISTRIBUTION  Accumulate N simulated games into a full outcome distribution     ─ simulate.summarizeSamples,
              per prop — never a point estimate.                                   runPitcherJointSimulation
   ↓
MARKET        A PrizePicks / sportsbook line is applied ONLY here, as a          ─ props.propSimulationFromJoint,
              threshold read of the finished distribution. It never re-projects.    evaluate.probsFromDistribution
   ↓
DECISION      Veto engine + policy resolve a firm BET/WAIT/NO_BET.               ─ prizepicks/decision
   ↓
POSTGAME      Grade against official results; DNP/void/push are distinct from    ─ grading.computeActual/gradeResult
              a real 0; feed backtest calibration, never the projection.
```

The three load-bearing invariants that must hold at every link:

1. **The market line is downstream of the model.** It is a threshold, never an
   input to the projection. (Verified: `props.ts`, `paSim` lines map, `evaluate.ts`.)
2. **Zero ≠ unavailable.** A missing Statcast/game-log value stays `undefined`
   and is reported unavailable; a DNP is not a 0. (Verified: `grading.ts` returns
   `null`/`"void"` for ungradeable; `AGENTS.md` contract.)
3. **No temporal leakage.** Data created after first pitch never feeds a pregame
   projection. (Verified structurally: season resolver + snapshot/backtest cutoff.)

---

## 2. Method

- **Fan-out:** each link above was read against its implementing module and
  probed with a targeted numeric experiment where behavior was uncertain.
- **Verify:** claims were confirmed by running the actual code (Bun, pure-logic
  path) and inspecting outputs, not by reading comments.
- **Score:** 25 criteria, 1–10, scored harshly — a link scores high only if the
  code reproduces the baseball mechanism *and* is honest about what it omits.
- **Execute:** the single highest-impact **verified** correctness gap was fixed,
  tested, and re-measured this pass. Remaining items are registered, ranked, and
  left for follow-up rather than changed speculatively.

Standing constraints honored: no model-weight / coefficient / Monte-Carlo /
calibration changes; the correction applied is a **structural game invariant**,
not a tuned parameter (mean outputs move < 0.05 outs). No dependency changes.

---

## 3. Findings registry

Severity: **P0** = produces a wrong number a user could bet on; **P1** = a real
causal gap that bounds accuracy; **P2** = honesty/observability or a documented
simplification worth revisiting.

| ID | Area | Sev | Status | Evidence | Files | Affected props |
|----|------|-----|--------|----------|-------|----------------|
| F-01 | Pitcher outs exceed complete-game ceiling | **P0** | **FIXED this pass** | Elite high-budget sim produced up to **33 outs / 11 IP**, P(outs>27)=6.7% | `pitcher/jointSim.ts` | `pitcher_outs`, innings exceedance, any prop read past 9 IP |
| F-02 | Hitter PA opportunity not conditioned on today's lineup slot | P1 | Registered | `expectedPasPerGame` uses the player's own log average (empirically slot-correlated) but does not adjust when today's confirmed slot differs; `simulatePlateAppearances` default 4.2 | `paSim.ts` | all PA-modeled batter props |
| F-03 | Explicit role is inferred, not a first-class enum | P1 | **FIXED this pass** | `starterConfirmed` referred to the OPPONENT starter; any analyzed pitcher was implicitly assumed to start | `players/role.ts`, `analysis.ts` | pitcher props; relief/opener/bench cases |
| F-04 | Run model omits DP / steals / errors; all runs earned | P2 (documented) | Accept | `advance()` header states the simplification; no-error universe ⇒ all runs earned aligns with the *earned*-runs prop target | `entry/jointSim.ts` | `earned_runs` |
| F-05 | Opponent lineup Statcast neutral on the pitcher path | P2 (documented) | Accept | CLAUDE.md pitcher section documents opponent context is neutral in `runAnalysis` | `analysis.ts` | pitcher props (matchup precision) |
| F-06 | Historical hit rate visually separable from model probability | P2 | Verified OK | `performance.ts` carries no probability field; UI states "historical only" | `players/performance.ts` | display only |
| F-07 | DNP/void/push distinct from a real 0 | P2 | Verified OK | `computeActual` → `null` for ungradeable; `gradeResult` → `"void"` for non-finite | `grading.ts` | grading/backtest |

**F-01 is the only P0 and is fixed this pass** (Section 4). F-02/F-03 are the
top-ranked follow-ups: both are additive, require confirmed-lineup / role inputs
that are only *sometimes* available, and must degrade to today's behavior when
those inputs are absent — so they are correctly deferred to a dedicated change
rather than rushed here.

---

## 4. Correction applied this pass — F-01: complete-game outs ceiling

**The gap.** `simulatePitcherStart` accumulates outs batter-by-batter and ends
the outing only via the removal hazard or a batters-faced safety bound
(`maxBattersFaced = 34`). For a dominant, low-contact starter given a high pitch
budget, the removal-hazard tail can run an outing well past nine innings. A
starter **cannot** record more than 27 outs — a complete nine-inning game is the
hard ceiling; modern extra-inning starts are effectively extinct.

**Measured before the fix** (elite rates, inflated budget, 30k iterations):

```
max outs: 33   P(outs>27): 6.7%   mean outs: 23.09 / 7.7 IP
```

Six-plus percent of simulated starts violated a hard baseball invariant, and
that mass inflates `pitcher_outs` and innings-exceedance probabilities in the
right tail — precisely the region a "6.5+ outs / 7+ IP" line lives in.

**The fix.** A structural ceiling, not a tuned parameter:

```ts
export const MAX_START_OUTS = 27; // complete nine-inning game

// inside the batter loop, after recording the out, before the removal hazard:
if (o.outs >= MAX_START_OUTS) { o.removedReason = "completed"; break; }
```

**Measured after the fix** (same inputs):

```
max outs: 27   P(outs>27): 0%    mean outs: 23.05 / 7.68 IP
```

The ceiling is enforced; the mean moves by **0.04 outs** — proving this clips an
impossible tail rather than shifting the calibrated distribution. No rate,
weight, or Monte-Carlo mechanic changed.

**Tests added** (`pitcher.test.ts`, 28 pass):

- `simulatePitcherStart` never exceeds 27 outs across 500 seeds for an elite
  high-budget starter (would fail pre-fix).
- The full `runPitcherJointSimulation` pipeline's max `pitcher_outs` sample ≤ 27.

---

## 4b. Correction applied this pass — F-03: first-class player role

**The gap.** Role was never represented as a typed contract. `analysis.ts`
routed on the boolean `player.isPitcher`, and the only "starter" signal
(`starterConfirmed`) actually described the **opponent's** probable pitcher. As a
result *any* analyzed pitcher was implicitly assumed to be today's starter, and
the six-prop joint-**start** simulation was applied to them unconditionally — a
reliever or a pitcher not starting today would silently receive a full-start
projection with no flag.

**The fix.** A pure, tested `src/lib/players/role.ts`:

- `PlayerRole` = `STARTING_PITCHER | RELIEF_PITCHER | UNKNOWN_PITCHER_ROLE |
  STARTING_HITTER | BENCH | UNKNOWN_HITTER_ROLE`, each with a `RoleConfidence`
  (`confirmed | probable | assumed | none`), `isStarter`, `startModelApplies`,
  and an honest `note`.
- `classifyPitcherRole` resolves from the analyzed player's **own-side** probable
  starter (now captured in `OpponentContext.ownProbablePitcherId` from the same
  `mapGame` call — no new data source): id match → `STARTING_PITCHER`; a *different*
  posted probable → `RELIEF_PITCHER` (start model does **not** apply); none posted
  → `UNKNOWN_PITCHER_ROLE` with the start **assumed and labeled**, never asserted.
- `runAnalysis` computes `analysis.role` for every request and pushes a
  high-severity `role_mismatch` warning when a start-based projection is applied
  to a pitcher who is not today's probable starter.

This is a **structural/representational** change — no rates, weights, or
Monte-Carlo mechanics — so it carries no calibration risk and needs no
walk-forward validation to be correct. Tests (`role.test.ts`, 7 cases) encode the
invariants: a rostered non-starter is relief; an unknown lineup never silently
becomes "starting."

## 5. 25-criterion scorecard

Scored 1–10 after the F-01 fix. "Target ≥ 8." Items below 8 carry a registry id.

| # | Criterion | Score | Note |
|---|-----------|:----:|------|
| 1 | Player identity by MLBAM id, never name | 9 | Resolver keys on id; name only as fallback display |
| 2 | Season resolved from date, never hard-coded | 10 | `season.ts` single source; historical dates resolve correctly |
| 3 | Role (starter/reliever/hitter) drives the engine | 8 | **Fixed this pass (F-03):** first-class `PlayerRole` resolved from the own-side probable starter; relief pitchers flagged, start-model applicability explicit |
| 4 | Hitter opportunity = plate appearances | 7 | Opportunity IS separated from rate (expectedPA × per-PA rates), but expected PA is the player's own log average — today's lineup slot is not incorporated (F-02) |
| 5 | Pitcher opportunity = BF / pitch budget with provenance | 9 | `projectWorkloadBudget` with explicit priors + provenance/warnings |
| 6 | Per-chance rates shrunk to a league prior | 9 | Bayesian shrinkage, versioned priors, sample-size weight |
| 7 | Opponent/park/context applied multiplicatively | 8 | Hitter path adjusts on opposing pitcher; pitcher path neutral (F-05) |
| 8 | Events are coherent (K⊆out, HR⊆hit, walk≠hit) | 10 | `sampleOutcome` switch is mutually exclusive; invariant-tested |
| 9 | Runs emerge from base/out state, not a marginal rate | 8 | Bases-state `advance()`; DP/steals/errors omitted + documented (F-04) |
| 10 | Earned vs total runs handled honestly | 8 | No-error model ⇒ all runs earned, aligns with earned-runs prop target |
| 11 | Starter removal is endogenous (hook hazard) | 9 | Versioned logistic on pitches/runs/baserunners/TTO |
| 12 | **Outing bounded by real game structure (≤27 outs)** | **9** | **Fixed this pass (F-01); was 3** |
| 13 | DNP / void / push ≠ a real 0 | 9 | `computeActual`→null, `gradeResult`→void; not auto-zeroed |
| 14 | Zero ≠ unavailable for missing data | 9 | Undefined preserved; reported unavailable, never coerced |
| 15 | Full distribution retained, not a point estimate | 10 | `summarizeSamples` + retained joint samples |
| 16 | Market line applied AFTER the distribution | 10 | `propSimulationFromJoint` / `probsFromDistribution` read finished samples |
| 17 | Alternative lines reuse ONE distribution | 10 | goblin/standard/demon read the same samples; no re-projection |
| 18 | Correlated props share ONE simulated game | 10 | Joint sim; pairwise correlation from joint indicators, not marginals |
| 19 | Determinism under a seed | 10 | `mulberry32` keyed by player/prop/line; tested identical |
| 20 | No temporal leakage (data ≤ prediction < first pitch) | 9 | Season resolver + backtest feature-cutoff exclusion |
| 21 | Historical hit rate ≠ model probability | 9 | `performance.ts` carries no probability field; UI states so |
| 22 | Decision engine veto runs before any BET | 9 | Mandatory `veto.ts`; strict precedence; state-lifecycle gate |
| 23 | Ensemble renormalized over present models | 9 | Missing model never fabricated; probabilities sum to 1 |
| 24 | Backtest strictly chronological, baselines compared | 9 | Leakage-excluded; coin-flip / shrink baselines scored |
| 25 | Provenance carried end to end | 8 | Usage/decision provenance rich; opportunity-source labeling could deepen |

**Result:** after F-01 and F-03, **24 of 25 criteria are ≥ 8**. The lone
remaining 7 is criterion 4 (hitter opportunity), analyzed in Section 6.

---

## 6. The remaining sub-8 criterion (F-02) and its hard limit

**Criterion 4 — hitter opportunity — remains at 7**, honestly. Opportunity is
already a first-class concept separated from skill (expected PA × per-PA rates,
not a raw stat average), and the player's own game-log PA rate is a defensible
opportunity proxy — a leadoff hitter's log already averages ~4.6 PA/game, a #9
hitter's ~3.9, so the empirical rate *encodes* their typical slot. What is
missing is conditioning on **today's** lineup slot when it differs from the norm.

Raising this to ≥ 8 the right way is **partially blocked, not merely unstarted**,
and the block is documented rather than asserted:

- **HARD LIMIT — point-in-time lineup data.** Reliable *confirmed* batting order
  is posted by MLB only ~1–2h pregame; before that, only a *projected* slot
  exists, and in this sandbox the live 2026 lineup feed is intermittently
  synthetic (the same limit that makes walk-forward validation impossible here).
  So the marginal information a slot adds *over the empirical-log proxy* cannot be
  validated in this environment. **Tried:** the projected-lineup adapter
  (`api.getProjectedLineup`) exists and the role layer added this pass is ready to
  consume lineup membership; what is absent is trustworthy point-in-time slot
  data to justify and calibrate a slot→PA adjustment.
- **Calibration-protection rationale.** A slot→expected-PA override must thread
  through the calibrated Model-B (`paSim`) path inside the ensemble. Introducing
  it blind — without the validation data above — risks the very calibration the
  mission instructs us to preserve. Per criterion 25 (scientific honesty), adding
  unvalidated precision is worse than an honestly-labeled proxy.

**Recommended next action (when point-in-time lineup history is captured):** add a
pure `expectedPaForLineupSlot` structural table (observable PA-by-slot facts, not
fitted coefficients), feed the resolved slot through `RoleResolution` →
`paSim.expectedPa` with a clean fallback to the log average, and validate the
change against captured snapshots before shipping.

**Also still true:** live 2026 validation is partial for the same
data-availability reason; a formal walk-forward comparison of the pitcher joint
model vs the old marginal model is not claimed as done.

---

## 7. What changed on disk this pass

**F-01 — pitcher outs ceiling:**
- `src/lib/prediction/pitcher/jointSim.ts` — `MAX_START_OUTS = 27` + ceiling
  enforcement in the batter loop.
- `src/lib/prediction/pitcher/index.ts` — export `MAX_START_OUTS`.
- `src/lib/prediction/pitcher/pitcher.test.ts` — two invariant tests.

**F-03 — first-class player role:**
- `src/lib/players/role.ts` (new) — `PlayerRole` + `classifyPitcherRole` /
  `classifyHitterRole`, pure and dependency-free.
- `src/lib/players/role.test.ts` (new) — 7 role-invariant tests.
- `src/lib/mlb/analysis.ts` — capture `ownProbablePitcherId`, compute
  `analysis.role`, emit a high-severity `role_mismatch` warning for relief.
- `src/lib/domain/models.ts` — new `role_mismatch` warning code.
- Two existing test helpers updated to supply the now-required `role`.

**Docs:** `docs/audit/FULL_PROJECT_RECONSIDERATION.md` (this), `CLAUDE.md`.

No rates, weights, Monte-Carlo mechanics, or calibration were altered — both
corrections are structural (a game-invariant and a typed contract).
