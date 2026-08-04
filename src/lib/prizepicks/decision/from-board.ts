/* ============================================================================
   Board → firm decision pipeline (server). Shared by the chat tool and the
   /api/prizepicks/decision route so both produce the SAME canonical decision.
   Builds per-leg facts from the existing engine (runAnalysis + sensitivity +
   joint economics), runs the decision engine, and persists immutably.
   ========================================================================== */

import { getPlayer, getGameLog } from "@/lib/mlb/api";
import { mapPlayer } from "@/lib/providers/mlbStats";
import { runAnalysis, MODEL_VERSION } from "@/lib/mlb/analysis";
import { getProp } from "@/lib/props/catalog";
import {
  estimatePaRates, expectedPasPerGame, estimatePitcherAllowedRates, expectedBattersFaced,
} from "@/lib/prediction/paSim";
import { resolveMarket } from "@/lib/prizepicks/market-map";
import { analyzeEntry, type EntryLegInput } from "@/lib/prizepicks/entry/entry";
import type { GameLogEntry } from "@/lib/domain/models";
import { evaluateEntry } from "./evaluate-entry";
import { runSensitivity } from "./sensitivity";
import { getDecisionStore } from "./store";
import { deriveMarketFacts, deriveEntryPayoutVerified } from "@/lib/supabase/derive-facts";
import type { EntryFacts, LegFacts } from "./evaluate-entry";
import type { DecisionResult } from "./types";

export interface BoardLeg {
  playerName: string;
  marketKey?: string;
  rawMarketLabel?: string;
  line: number;
  mlbPlayerId?: number;
}

export interface DecideEntryInput {
  board: BoardLeg[];
  entryType: "power" | "flex";
  season: number;
  date: string;
}

export interface DecideEntryResult {
  entryDecision: DecisionResult;
  legDecisions: DecisionResult[];
  /** research-only when no market is server-validated; server-derived otherwise.
      There is NO client control — the state comes from the model registry. */
  marketMode: "research-only" | "server-derived";
  warnings: string[];
}

function toLog(raw: unknown[]): GameLogEntry[] {
  return (raw as { stat: unknown; date?: string; isHome?: boolean; gamePk?: number }[]).map((sp) => {
    const stat: Record<string, number> = {};
    for (const [k, v] of Object.entries(sp.stat as Record<string, unknown>)) {
      const n = typeof v === "number" ? v : Number(v);
      if (Number.isFinite(n)) stat[k] = n;
    }
    return { stat, date: sp.date, isHome: sp.isHome, gamePk: sp.gamePk };
  });
}

export async function decideEntryFromBoard(input: DecideEntryInput): Promise<DecideEntryResult> {
  const board = input.board.slice(0, 6);
  const warnings: string[] = ["Analysis uses the imported (not live) board; direction defaults to the model-favored side."];
  if (board.length < 2) {
    return { entryDecision: unavailableEntry("Entry needs at least 2 imported legs."), legDecisions: [], marketMode: "research-only", warnings };
  }
  // Trusted per-entry payout verification — a generic default never backs a BET.
  const payoutVerified = await deriveEntryPayoutVerified(input.entryType, board.length);
  let anyServerValidated = false;

  const legFacts: LegFacts[] = [];
  const legModels: EntryLegInput[] = [];
  const nowIso = new Date().toISOString();

  for (let i = 0; i < board.length; i++) {
    const e = board[i];
    const market = e.marketKey ?? resolveMarket(e.rawMarketLabel ?? "").market?.canonical;
    const prop = market ? getProp(market) : undefined;
    const rawPlayer = e.mlbPlayerId ? await getPlayer(e.mlbPlayerId).catch(() => null) : null;
    const player = rawPlayer ? mapPlayer(rawPlayer) : null;

    if (!e.mlbPlayerId || !market || !prop || !player) {
      legFacts.push(baseFacts({ playerId: e.mlbPlayerId, market: market ?? e.rawMarketLabel ?? "unknown", line: e.line, playerResolved: !!player, marketSupported: !!prop }));
      warnings.push(`Leg "${e.playerName}" unresolved (player/market).`);
      continue;
    }

    const isPitcher = player.isPitcher;
    const payload = await runAnalysis({ playerId: e.mlbPlayerId, propKey: market, line: e.line, side: "over" }).catch(() => null);
    const a = payload?.analysis;
    const log = toLog((await getGameLog(e.mlbPlayerId, isPitcher ? "pitching" : "hitting", input.season).catch(() => [])) as unknown[]);

    const pMore = a?.simulation.probOver;
    const pLess = a?.simulation.probUnder;
    const side: "more" | "less" = (pMore ?? 0) >= (pLess ?? 0) ? "more" : "less";
    // Model-certainty confidence (independent of betting odds): sample size +
    // how decisive the directional probability is. NOT an odds-based edge.
    const selected = Math.max(pMore ?? 0, pLess ?? 0);
    const sampleSize = payload?.meta.sampleSize ?? 0;
    const confidence = a
      ? Math.round(Math.min(100, Math.max(0, Math.abs(selected - 0.5) * 140 + (Math.min(sampleSize, 30) / 30) * 30)))
      : undefined;

    let fragility: number | undefined;
    let worst: number | undefined;
    let volatility: number | undefined;
    if (log.length > 0 && a) {
      const sens = runSensitivity(
        isPitcher
          ? { kind: "pitcher", market, line: e.line, direction: side, rates: estimatePitcherAllowedRates(log), expected: expectedBattersFaced(log), seed: `d:${e.mlbPlayerId}:${market}` }
          : { kind: "hitter", market, line: e.line, direction: side, rates: estimatePaRates(log), expected: expectedPasPerGame(log), seed: `d:${e.mlbPlayerId}:${market}` },
      );
      fragility = sens.fragilityScore;
      worst = sens.worstProbability;
      volatility = Math.min(100, Math.round(((a.simulation.stdDev ?? 0) / Math.abs(a.projection.lambda || 1)) * 100));
    }

    // Scientific facts are SERVER-DERIVED from the persisted registry + monitoring
    // — the client cannot influence market validation, calibration or drift state.
    const facts = await deriveMarketFacts(market);
    if (facts.marketValidationState === "VALIDATED" || facts.marketValidationState === "PRODUCTION" || facts.marketValidationState === "PROVISIONAL") {
      anyServerValidated = true;
    }

    legFacts.push({
      playerId: e.mlbPlayerId, gamePk: payload?.opponent?.gamePk, market, line: e.line, isPitcher,
      playerResolved: true, gameResolved: !!payload?.opponent?.gamePk || isPitcher, marketSupported: true,
      probabilitiesAvailable: !!a,
      probabilityMore: pMore, probabilityLess: pLess, probabilityPush: a?.simulation.probPush,
      confidenceScore: confidence, dataQualityScore: payload?.dataQuality?.score,
      volatilityScore: volatility, fragilityScore: fragility, worstCaseSelectedProbability: worst,
      lineupRequired: !isPitcher, lineupConfirmed: payload?.opponent?.lineupConfirmed ?? false,
      pitcherMateriallyRelevant: !isPitcher, starterConfirmed: payload?.opponent?.starterConfirmed ?? false,
      gameStarted: false, snapshotBeforeEvent: true, featureCutoffBeforeStart: true,
      pregameSnapshotExists: true, modelVersionApproved: true,
      marketValidationState: facts.marketValidationState,
      calibrationDegraded: facts.calibrationDegraded,
      featureDriftExceeded: facts.featureDriftExceeded,
      outsideTrainingSupport: facts.outsideTrainingSupport,
    });
    legModels.push({
      id: `leg-${i}`, label: `${player.name} ${market} ${e.line}`, playerId: e.mlbPlayerId,
      market, direction: side, line: e.line,
      model: isPitcher
        ? { kind: "pitcher", allowedRates: estimatePitcherAllowedRates(log), expectedBF: expectedBattersFaced(log) }
        : { kind: "hitter", rates: estimatePaRates(log), expectedPa: expectedPasPerGame(log) },
    });
  }

  const econ = legModels.length >= 2 ? analyzeEntry({ legs: legModels, entryType: input.entryType, iterations: 6000, seed: `decide:${input.date}` }) : null;

  const entryFacts: EntryFacts = {
    legs: legFacts, entryFormat: input.entryType, method: econ?.method ?? "joint-simulation",
    payoutConfigured: econ?.economics.configured ?? false, payoutFixable: true,
    payoutTableId: econ ? "pp-default-2026.1" : null, payoutTableVersion: econ?.economics.tableVersion ?? null,
    economics: {
      configured: econ?.economics.configured ?? false,
      expectedReturn: econ?.economics.expectedReturn,
      expectedProfit: econ?.economics.expectedProfit,
      variance: econ?.variance,
      downsideProbability: econ?.downsideProbability,
    },
    correlationConcentration: (econ?.contradictions.length ?? 0) > 0,
    // payoutVerified is SERVER-DERIVED: true only when a verified payout snapshot
    // exists for this format/pick-count. A generic default keeps it false.
    payoutVerified,
    modelVersion: MODEL_VERSION, featureCutoff: nowIso, dataAsOf: nowIso,
  };

  const { entryDecision, legDecisions } = evaluateEntry(entryFacts);
  await getDecisionStore().record(`entry:${input.date}:${board.map((b) => b.mlbPlayerId).join("-")}`, entryDecision).catch(() => null);

  const marketMode: DecideEntryResult["marketMode"] = anyServerValidated ? "server-derived" : "research-only";
  if (!anyServerValidated) {
    warnings.push("No market is server-validated (model registry defaults to RESEARCH_ONLY) — firm BET decisions are prohibited by policy.");
  }

  return {
    entryDecision,
    legDecisions,
    marketMode,
    warnings: [...warnings, ...entryDecision.reasons.filter((r) => r.severity !== "INFO").map((r) => r.message)],
  };
}

function baseFacts(over: Partial<LegFacts>): LegFacts {
  return {
    market: "unknown", line: 0, isPitcher: false,
    playerResolved: false, gameResolved: false, marketSupported: false, probabilitiesAvailable: false,
    lineupRequired: false, lineupConfirmed: false, pitcherMateriallyRelevant: false, starterConfirmed: false,
    gameStarted: false, snapshotBeforeEvent: true, featureCutoffBeforeStart: true,
    pregameSnapshotExists: true, modelVersionApproved: true, marketValidationState: "RESEARCH_ONLY",
    ...over,
  };
}

function unavailableEntry(message: string): DecisionResult {
  const now = new Date().toISOString();
  return {
    decision: "UNAVAILABLE", subjectType: "ENTRY",
    decisionPolicyId: "diamond-edge-conservative", decisionPolicyVersion: "1.0.0",
    modelVersion: MODEL_VERSION, configChecksum: "00000000",
    generatedAt: now, featureCutoff: now, dataAsOf: now,
    reasons: [{ code: "NOT_ENOUGH_LEGS", category: "ENTRY_EV", severity: "CRITICAL", message }],
    vetoes: [],
  };
}
