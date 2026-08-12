/* ============================================================================
   Server-side prop analysis orchestrator (Phase 2). Fetches a player's game log
   and Statcast from the provider layer, resolves the opposing starter and park,
   builds an explainable adjustment breakdown, runs either the plate-appearance
   simulation (for PA-modeled batter props) or the marginal Monte Carlo, and
   returns a fully-provenanced, quality-scored payload.
   ========================================================================== */

import { getPlayer, getGameLog, getMultiSeasonGameLog, getSchedule, getCurrentMlbSeason } from "./api";
import { extractPropSeries, seriesValues, statGroupForProp, type PropGameSample } from "./series";
import { mapPlayer, mapGame } from "@/lib/providers/mlbStats";
import { savantStatcastProvider } from "@/lib/providers/statcast";
import { staticParkProvider } from "@/lib/providers/park";
import { getProp } from "@/lib/props/catalog";
import { project } from "@/lib/prediction/projection";
import { simulate, recommend, type SimulationResult } from "@/lib/prediction/simulate";
import { analyzeStat, type Side, type StatAnalytics } from "@/lib/analytics/hitRate";
import { buildAdjustmentBreakdown, pitcherOffenseMultiplierForProp } from "@/lib/prediction/adjustments";
import {
  estimatePaRates, expectedPasPerGame, adjustPaRates, paAdjustmentsFromPitcher,
  simulatePlateAppearances, PA_MODELED_PROPS,
} from "@/lib/prediction/paSim";
import { scoreDataQuality, buildWarnings } from "@/lib/prediction/quality";
import {
  buildPitcherJoint, propSimulationFromJoint, PITCHER_JOINT_PROPS,
  type PitcherJointSimulation, type PitcherStartStat, type PitcherJointProp,
  type PitcherUsageProjection, type VolumeEfficiency, type PropCorrelation,
} from "@/lib/prediction/pitcher";
import { computeModelEnsemble } from "@/lib/models";
import type { ModelOutput, EnsembleOutput, ModelDisagreement } from "@/lib/models";
import type {
  AdjustmentBreakdown, DataQuality, PredictionProvenance, PredictionWarning,
  StatcastBatter, StatcastPitcher,
} from "@/lib/domain/models";
import type { PropDef } from "@/lib/props/catalog";

export const MODEL_VERSION = "2.0.0-statcast";

export interface AnalysisRequest {
  playerId: number;
  propKey: string;
  line?: number;
  side?: Side;
  overAmerican?: number;
  underAmerican?: number;
  venueSplit?: "home" | "away";
  lastN?: number;
  season?: number;
  multiSeason?: boolean;
}

export interface EngineAnalysis {
  prop: PropDef;
  line: number;
  side: Side;
  projection: ReturnType<typeof project>;
  simulation: SimulationResult;
  analytics: StatAnalytics;
  recommendation: ReturnType<typeof recommend>;
  modeledBy: "plate-appearance" | "marginal" | "pitcher-joint";
  /** Parallel deterministic model outputs (additive; backward compatible). */
  models: ModelOutput[];
  ensemble: EnsembleOutput;
  modelDisagreement: ModelDisagreement;
  /** Pitcher usage/exposure projection (present only for pitcher-joint props). */
  pitcherUsage?: PitcherUsageProjection;
  /** Volume/efficiency + same-pitcher joint correlations (pitcher-joint props). */
  pitcherJoint?: { volumeEfficiency: VolumeEfficiency; correlations: PropCorrelation[]; version: string };
}

export interface OpponentContext {
  pitcherId?: number;
  pitcherName?: string;
  pitcherHand?: string;
  venueName?: string;
  opponentTeam?: string;
  opponentTeamId?: number;
  gamePk?: number;
  lineupConfirmed: boolean;
  starterConfirmed: boolean;
}

export interface AnalysisPayload {
  player: {
    id: number;
    name: string;
    position: string;
    team: string;
    bats?: string;
    throws?: string;
  } | null;
  samples: PropGameSample[];
  analysis: EngineAnalysis | null;
  statcast: { batter?: StatcastBatter | null; pitcher?: StatcastPitcher | null };
  opponent: OpponentContext | null;
  breakdown: AdjustmentBreakdown | null;
  warnings: PredictionWarning[];
  dataQuality: DataQuality | null;
  provenance: PredictionProvenance | null;
  meta: { propKey: string; line: number; sampleSize: number; filteredFrom: number; season: number };
  lastUpdated: number;
  error?: string;
}

/** Find today's game + opposing starter for a player's team. */
async function resolveOpponent(teamId: number | undefined): Promise<OpponentContext | null> {
  if (!teamId) return null;
  const today = new Date().toISOString().slice(0, 10);
  const games = await getSchedule(today).catch(() => []);
  for (const raw of games) {
    const g = mapGame(raw);
    const isHome = g.home.teamId === teamId;
    const isAway = g.away.teamId === teamId;
    if (!isHome && !isAway) continue;
    const opp = isHome ? g.away : g.home;
    return {
      pitcherId: opp.probablePitcherId,
      pitcherName: opp.probablePitcherName,
      venueName: g.venueName,
      opponentTeam: opp.teamName,
      opponentTeamId: opp.teamId,
      gamePk: g.gamePk,
      lineupConfirmed: false, // MLB confirms lineups ~1-2h pregame; treated as projected here
      starterConfirmed: opp.probablePitcherId !== undefined,
    };
  }
  return null;
}

export async function runAnalysis(req: AnalysisRequest): Promise<AnalysisPayload> {
  const prop = getProp(req.propKey);
  const season = req.season ?? getCurrentMlbSeason();
  const lastUpdated = Date.now();

  const rawPlayer = await getPlayer(req.playerId).catch(() => null);
  const player = rawPlayer ? mapPlayer(rawPlayer) : null;
  const playerInfo = player
    ? { id: player.id, name: player.name, position: player.position, team: player.teamName ?? "", bats: player.bats, throws: player.throws }
    : null;

  if (!prop || !player) {
    return {
      player: playerInfo, samples: [], analysis: null, statcast: {}, opponent: null,
      breakdown: null, warnings: [], dataQuality: null, provenance: null,
      meta: { propKey: req.propKey, line: 0, sampleSize: 0, filteredFrom: 0, season },
      lastUpdated, error: !prop ? "unknown_prop" : "unknown_player",
    };
  }

  const group = statGroupForProp(req.propKey);
  const [log, opponent] = await Promise.all([
    req.multiSeason ? getMultiSeasonGameLog(player.id, group) : getGameLog(player.id, group, season),
    prop.category === "batter" ? resolveOpponent(player.teamId) : Promise.resolve(null),
  ]);

  // Statcast: the player's own row + (for batters) the opposing starter's row.
  const [ownStatcast, oppStatcast] = await Promise.all([
    player.isPitcher
      ? savantStatcastProvider.getPitcher(player.id, season).catch(() => null)
      : savantStatcastProvider.getBatter(player.id, season).catch(() => null),
    opponent?.pitcherId
      ? savantStatcastProvider.getPitcher(opponent.pitcherId, season).catch(() => null)
      : Promise.resolve(null),
  ]);

  // Prop series (venue/lastN filtered) for hit-rate analytics + base projection.
  let samples = extractPropSeries(req.propKey, log);
  const filteredFrom = samples.length;
  if (req.venueSplit === "home") samples = samples.filter((s) => s.isHome);
  else if (req.venueSplit === "away") samples = samples.filter((s) => s.isHome === false);
  if (req.lastN && req.lastN > 0) samples = samples.slice(Math.max(0, samples.length - req.lastN));

  const series = seriesValues(samples);
  const line = req.line ?? prop.defaultLine;
  const side = req.side ?? "over";

  if (series.length === 0) {
    return {
      player: playerInfo, samples: [], analysis: null,
      statcast: player.isPitcher ? { pitcher: ownStatcast as StatcastPitcher } : { batter: ownStatcast as StatcastBatter },
      opponent, breakdown: null, warnings: [], dataQuality: null, provenance: null,
      meta: { propKey: req.propKey, line, sampleSize: 0, filteredFrom, season },
      lastUpdated, error: "no_series_data",
    };
  }

  const analytics = analyzeStat(series, line, side);

  // Base = shrunk expectation with NO context (context is applied explicitly below).
  const baseProjection = project({ series, family: prop.family });
  const base = baseProjection.shrunkMean;

  const venueName = opponent?.venueName;
  const breakdown = buildAdjustmentBreakdown({
    propKey: req.propKey,
    base,
    venueName,
    batterHand: player.bats,
    opposingPitcher: prop.category === "batter" ? (oppStatcast as StatcastPitcher | null) : null,
    opposingPitcherHand: undefined,
    formRatio: analytics.trend.formRatio,
  });

  const finalLambda = breakdown.final;
  const projection = { ...baseProjection, lambda: finalLambda, contextMultiplier: base > 0 ? finalLambda / base : 1 };

  // The marginal Monte-Carlo (Model A) is always computed — it is the baseline
  // simulator and the reused output for the parallel-model ensemble.
  const seed = `${player.id}:${req.propKey}:${line}`;
  const marginalSim = simulate(projection, line, { seed });

  // Choose the primary simulator: PA engine for batting props it models directly.
  let simulation: SimulationResult = marginalSim;
  let paSim: SimulationResult | undefined;
  let modeledBy: "plate-appearance" | "marginal" | "pitcher-joint" = "marginal";
  let pitcherUsage: PitcherUsageProjection | undefined;
  let pitcherJoint: { volumeEfficiency: VolumeEfficiency; correlations: PropCorrelation[]; version: string } | undefined;

  // Pitcher props share ONE joint start simulation (usage + removal hazard +
  // correlated events). The market line is applied AFTER, so the same simulation
  // (memoized per player/season/snapshot) powers all six props unchanged.
  if (prop.category === "pitcher" && isPitcherJointProp(req.propKey) && !req.venueSplit && !req.lastN) {
    const joint = getOrBuildPitcherJoint(player.id, season, log);
    const propSim = propSimulationFromJoint(joint, req.propKey as PitcherJointProp, line, prop.family);
    simulation = propSim;
    paSim = propSim; // feeds the ensemble's structural (Model B) slot for pitchers
    modeledBy = "pitcher-joint";
    pitcherUsage = joint.usage;
    pitcherJoint = { volumeEfficiency: joint.volumeEfficiency, correlations: joint.correlations, version: joint.version };
  } else if (prop.category === "batter" && PA_MODELED_PROPS.has(req.propKey) && !req.venueSplit && !req.lastN) {
    const rates0 = estimatePaRates(log.map((sp) => ({ stat: numify(sp.stat as unknown as Record<string, unknown>) })));
    const offenseMult = pitcherOffenseMultiplierForProp(req.propKey, oppStatcast as StatcastPitcher | null);
    const paAdj = paAdjustmentsFromPitcher(oppStatcast as StatcastPitcher | null, offenseMult);
    const rates = adjustPaRates(rates0, paAdj);
    const expectedPa = expectedPasPerGame(log.map((sp) => ({ stat: numify(sp.stat as unknown as Record<string, unknown>) })));
    const results = simulatePlateAppearances(rates, { [req.propKey]: line } as Record<string, number>, {
      iterations: 10000,
      seed,
      expectedPa,
    });
    if (results[req.propKey]) {
      simulation = results[req.propKey];
      paSim = results[req.propKey];
      modeledBy = "plate-appearance";
    }
  }

  // Parallel deterministic models → ensemble → disagreement (additive, reuses the
  // sims above; never recomputes projections and never asks an LLM for a number).
  const modelEnsemble = computeModelEnsemble({
    series, family: prop.family, line, seed, marginalSim, paSim, modelVersion: MODEL_VERSION,
  });

  const recommendation = recommend({
    sim: simulation,
    overAmerican: req.overAmerican,
    underAmerican: req.underAmerican,
    sampleSize: series.length,
  });

  const hasStatcast = !!ownStatcast && ownStatcast.availableMetrics.length > 0;
  const hasOpponent = prop.category === "batter" ? !!oppStatcast : false;
  const dataQuality = scoreDataQuality({
    sampleSize: series.length,
    hasStatcast,
    hasOpponent,
    hasWeather: false,
    hasLineup: false,
  });

  const modelDisagreement = recommendation.best
    ? Math.abs(recommendation.best.modelProb - recommendation.best.impliedProb)
    : undefined;

  const warnings = buildWarnings({
    sampleSize: series.length,
    hasStatcast,
    hasOpponent,
    hasWeather: false,
    lineupConfirmed: opponent?.lineupConfirmed ?? false,
    starterConfirmed: opponent?.starterConfirmed ?? false,
    manualOdds: req.overAmerican !== undefined || req.underAmerican !== undefined,
    modelDisagreement,
    dataAgeMs: ownStatcast ? Date.now() - ownStatcast.fetchedAt : undefined,
  });

  const provenance: PredictionProvenance = {
    modelVersion: MODEL_VERSION,
    seed: `${player.id}:${req.propKey}:${line}`,
    dataTimestamp: lastUpdated,
    sources: [
      { name: "mlb-stats-api", available: true, fetchedAt: lastUpdated },
      { name: "baseball-savant", available: hasStatcast, fetchedAt: ownStatcast?.fetchedAt },
      { name: "static-park-factors", available: !!venueName && staticParkProvider.getFactor(venueName).runs !== 1 },
    ],
  };

  return {
    player: playerInfo,
    samples,
    analysis: {
      prop, line, side, projection, simulation, analytics, recommendation, modeledBy,
      models: modelEnsemble.models,
      ensemble: modelEnsemble.ensemble,
      modelDisagreement: modelEnsemble.disagreement,
      pitcherUsage,
      pitcherJoint,
    },
    statcast: player.isPitcher ? { pitcher: ownStatcast as StatcastPitcher } : { batter: ownStatcast as StatcastBatter, pitcher: oppStatcast as StatcastPitcher },
    opponent,
    breakdown,
    warnings,
    dataQuality,
    provenance,
    meta: { propKey: req.propKey, line, sampleSize: series.length, filteredFrom, season },
    lastUpdated,
  };
}

function isPitcherJointProp(key: string): boolean {
  return (PITCHER_JOINT_PROPS as readonly string[]).includes(key);
}

/**
 * ONE joint pitcher-start simulation per (player, season, game-log snapshot). All
 * six pitcher props read from it, so the expensive simulation runs once — a new
 * start (log length change) invalidates the memo. The seed is line-independent by
 * construction, so a market line never changes the underlying simulation.
 */
const pitcherJointCache = new Map<string, PitcherJointSimulation>();
const PITCHER_JOINT_CACHE_MAX = 200;

function getOrBuildPitcherJoint(playerId: number, season: number, log: { stat: unknown }[]): PitcherJointSimulation {
  // Only true starts (≥ ~3 IP) inform usage/rates; relief outings would distort them.
  const starts = log
    .map((sp) => numify(sp.stat as Record<string, unknown>) as unknown as PitcherStartStat)
    .filter((s) => (s.outs ?? 0) >= 9 || (s.battersFaced ?? 0) >= 12);
  const key = `${playerId}:${season}:${starts.length}`;
  const cached = pitcherJointCache.get(key);
  if (cached) return cached;
  const joint = buildPitcherJoint({ starts, seed: `${playerId}:pitcher-joint:${season}:${starts.length}` });
  if (pitcherJointCache.size >= PITCHER_JOINT_CACHE_MAX) {
    const first = pitcherJointCache.keys().next().value;
    if (first !== undefined) pitcherJointCache.delete(first);
  }
  pitcherJointCache.set(key, joint);
  return joint;
}

/** Coerce a raw stat bag (numbers or numeric strings) into numbers. */
function numify(stat: Record<string, unknown>): Record<string, number> {
  const out: Record<string, number> = {};
  for (const [k, v] of Object.entries(stat)) {
    const n = typeof v === "number" ? v : Number(v);
    if (Number.isFinite(n)) out[k] = n;
  }
  return out;
}
