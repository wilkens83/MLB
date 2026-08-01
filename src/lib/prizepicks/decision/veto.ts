/* ============================================================================
   Mandatory gate + veto computation. Runs BEFORE any final decision is assigned.
   It classifies every triggered condition into one of three blocking classes —
   UNAVAILABLE (cannot decide), WAIT (may become valid later), NO_BET (complete
   but rejected) — and records the blocking vetoes that make BET_MORE/BET_LESS
   impossible. A BET can only be produced when NO condition triggers.
   ========================================================================== */

import type { DecisionPolicy, DecisionReason, DecisionVeto, MarketValidationState } from "./types";
import { reason, veto, VETO } from "./reasons";

/** Normalized facts about one leg, computed upstream from real data. */
export interface LegFacts {
  playerId?: number;
  gamePk?: number;
  market: string;
  line: number;
  isPitcher: boolean;

  // resolution / mapping
  playerResolved: boolean;
  gameResolved: boolean;
  doubleheaderAmbiguous?: boolean;
  marketSupported: boolean;
  invalidLine?: boolean;

  // projection
  probabilitiesAvailable: boolean;
  probabilityMore?: number;
  probabilityLess?: number;
  probabilityPush?: number;
  confidenceScore?: number;
  dataQualityScore?: number;
  volatilityScore?: number;
  fragilityScore?: number;
  /** Worst credible selected-side probability from the sensitivity sweep. */
  worstCaseSelectedProbability?: number;

  // status
  lineupRequired: boolean;
  lineupConfirmed: boolean;
  pitcherMateriallyRelevant: boolean;
  starterConfirmed: boolean;
  roleUncertain?: boolean;
  weatherMaterialButMissing?: boolean;
  providerConflict?: boolean;
  providerTemporarilyMissing?: boolean;

  // timing / integrity
  lineAgeMinutes?: number;
  lineStaleButRefreshable?: boolean;
  gameStarted: boolean;
  snapshotBeforeEvent: boolean;
  featureCutoffBeforeStart: boolean;
  pregameSnapshotExists: boolean;
  modelVersionApproved: boolean;
  contradictorySimulation?: boolean;
  pipelineIntegrityFailure?: boolean;

  // market model validation
  marketValidationState: MarketValidationState;
}

/** Hard floors independent of the (softer) BET thresholds. */
const HARD_DATA_QUALITY_FLOOR = 50;
const HARD_FRAGILITY_CEILING = 60;

export interface GateResult {
  unavailable: DecisionReason[];
  wait: DecisionReason[];
  noBet: DecisionReason[];
  vetoes: DecisionVeto[];
  info: DecisionReason[];
}

/** Compute UNAVAILABLE / WAIT / NO_BET classes + blocking vetoes for a leg. */
export function computeLegGates(f: LegFacts, policy: DecisionPolicy): GateResult {
  const unavailable: DecisionReason[] = [];
  const wait: DecisionReason[] = [];
  const noBet: DecisionReason[] = [];
  const vetoes: DecisionVeto[] = [];
  const info: DecisionReason[] = [];
  const block = (v: DecisionVeto) => vetoes.push(v);

  /* ---- UNAVAILABLE: cannot produce a valid decision ---- */
  if (!f.marketSupported) {
    unavailable.push(reason("MARKET_UNSUPPORTED", "MARKET", "CRITICAL", `Market "${f.market}" is not supported.`));
    block(veto(VETO.MARKET_UNSUPPORTED, `Unsupported market "${f.market}".`));
  }
  if (policy.requireConfirmedPlayer && !f.playerResolved) {
    unavailable.push(reason("PLAYER_UNRESOLVED", "MAPPING", "CRITICAL", "Player not resolved to an MLBAM id."));
    block(veto(VETO.PLAYER_UNRESOLVED, "Player mapping unresolved."));
  }
  if (policy.requireConfirmedGame && !f.gameResolved) {
    unavailable.push(reason("GAME_UNRESOLVED", "MAPPING", "CRITICAL", "Game not resolved."));
    block(veto(VETO.GAME_UNRESOLVED, "Game mapping unresolved."));
  }
  if (f.doubleheaderAmbiguous) {
    unavailable.push(reason("DOUBLEHEADER_AMBIGUOUS", "MAPPING", "CRITICAL", "Ambiguous doubleheader mapping."));
    block(veto(VETO.DOUBLEHEADER_AMBIGUOUS, "Ambiguous doubleheader."));
  }
  if (f.invalidLine) {
    unavailable.push(reason("INVALID_LINE", "MARKET", "CRITICAL", "Imported line is invalid."));
  }
  if (!f.probabilitiesAvailable) {
    unavailable.push(reason("NO_PROJECTION", "PROBABILITY", "CRITICAL", "No valid probability distribution."));
  }
  if (f.gameStarted) {
    unavailable.push(reason("GAME_STARTED", "FRESHNESS", "CRITICAL", "Game already started before decision."));
    block(veto(VETO.GAME_STARTED, "Game already started."));
  }
  if (policy.requirePregameSnapshot && !f.snapshotBeforeEvent) {
    unavailable.push(reason("SNAPSHOT_AFTER_START", "MODEL_VALIDATION", "CRITICAL", "Snapshot created after event start."));
    block(veto(VETO.SNAPSHOT_AFTER_START, "Snapshot created after event start."));
  }
  if (!f.featureCutoffBeforeStart) {
    unavailable.push(reason("FUTURE_DATA_LEAKAGE", "MODEL_VALIDATION", "CRITICAL", "Feature cutoff is after event start (leakage)."));
    block(veto(VETO.FUTURE_DATA_LEAKAGE, "Future-data leakage detected."));
  }
  if (!f.modelVersionApproved) {
    unavailable.push(reason("MODEL_VERSION_UNAPPROVED", "MODEL_VALIDATION", "CRITICAL", "Model version not approved."));
    block(veto(VETO.MODEL_VERSION_UNAPPROVED, "Model version not approved."));
  }
  if (f.contradictorySimulation) {
    unavailable.push(reason("CONTRADICTORY_SIMULATION", "PROBABILITY", "CRITICAL", "Contradictory simulation outputs (probabilities inconsistent)."));
    block(veto(VETO.CONTRADICTORY_SIMULATION, "Contradictory simulation outputs."));
  }
  if (f.pipelineIntegrityFailure) {
    unavailable.push(reason("PIPELINE_INTEGRITY", "PROVIDER", "CRITICAL", "Grading/feature pipeline integrity failure."));
    block(veto(VETO.PIPELINE_INTEGRITY, "Pipeline integrity failure."));
  }
  if (f.providerConflict) {
    unavailable.push(reason("PROVIDER_CONFLICT", "PROVIDER", "CRITICAL", "Unresolved critical provider conflict."));
    block(veto(VETO.PROVIDER_CONFLICT, "Critical provider conflict."));
  }

  /* ---- WAIT: may become valid after new information ---- */
  if (f.lineupRequired && policy.requireConfirmedLineupForHitters && !f.lineupConfirmed) {
    wait.push(reason("LINEUP_UNCONFIRMED", "LINEUP", "CRITICAL", "Hitter lineup is projected, not confirmed."));
    block(veto(VETO.LINEUP_UNCONFIRMED, "Required lineup unconfirmed."));
  }
  if (f.pitcherMateriallyRelevant && policy.requireConfirmedPitcher && !f.starterConfirmed) {
    wait.push(reason("PITCHER_UNCONFIRMED", "PITCHER", "CRITICAL", "Probable pitcher not confirmed."));
    block(veto(VETO.PITCHER_UNCONFIRMED, "Required probable pitcher unconfirmed."));
  }
  if (f.roleUncertain) wait.push(reason("ROLE_UNCERTAIN", "PITCHER", "WARNING", "Player role (opener/bulk) is uncertain."));
  if (f.weatherMaterialButMissing) wait.push(reason("WEATHER_MISSING", "DATA_QUALITY", "WARNING", "Material weather data is missing."));
  if (f.lineStaleButRefreshable) wait.push(reason("LINE_REFRESHING", "FRESHNESS", "WARNING", "Line is temporarily stale but may refresh."));
  if (f.providerTemporarilyMissing) wait.push(reason("PROVIDER_TEMPORARY", "PROVIDER", "WARNING", "A provider is temporarily unavailable."));

  /* ---- Hard-floor vetoes → NO_BET (analysis complete but blocked) ---- */
  if (f.lineAgeMinutes !== undefined && f.lineAgeMinutes > policy.maximumLineAgeMinutes && !f.lineStaleButRefreshable) {
    noBet.push(reason("LINE_STALE", "FRESHNESS", "CRITICAL", `Line age ${f.lineAgeMinutes}m exceeds ${policy.maximumLineAgeMinutes}m.`, f.lineAgeMinutes, policy.maximumLineAgeMinutes));
    block(veto(VETO.LINE_STALE, `Line older than ${policy.maximumLineAgeMinutes} minutes.`));
  }
  if (f.dataQualityScore !== undefined && f.dataQualityScore < HARD_DATA_QUALITY_FLOOR) {
    noBet.push(reason("DATA_QUALITY_FLOOR", "DATA_QUALITY", "CRITICAL", `Data quality ${f.dataQualityScore} below hard floor ${HARD_DATA_QUALITY_FLOOR}.`, f.dataQualityScore, HARD_DATA_QUALITY_FLOOR));
    block(veto(VETO.DATA_QUALITY_FLOOR, "Data quality below hard floor."));
  }
  if (f.fragilityScore !== undefined && f.fragilityScore > HARD_FRAGILITY_CEILING) {
    noBet.push(reason("FRAGILITY_CEILING", "FRAGILITY", "CRITICAL", `Fragility ${f.fragilityScore} above hard ceiling ${HARD_FRAGILITY_CEILING}.`, f.fragilityScore, HARD_FRAGILITY_CEILING));
    block(veto(VETO.FRAGILITY_CEILING, "Fragility above hard ceiling."));
  }
  if (f.marketValidationState === "SUSPENDED") {
    noBet.push(reason("MARKET_SUSPENDED", "MODEL_VALIDATION", "CRITICAL", "Market is SUSPENDED due to drift/calibration failure."));
    block(veto(VETO.MARKET_SUSPENDED, "Market suspended."));
  }
  if (f.marketValidationState === "RESEARCH_ONLY") {
    noBet.push(reason("MARKET_RESEARCH_ONLY", "MODEL_VALIDATION", "WARNING", "Market is RESEARCH_ONLY — firm BET decisions are prohibited."));
    block(veto(VETO.MARKET_RESEARCH_ONLY, "Market is research-only."));
  }

  return { unavailable, wait, noBet, vetoes, info };
}
