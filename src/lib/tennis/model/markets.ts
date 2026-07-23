/* ============================================================================
   Tennis market models. Every market is read DIRECTLY off the structural
   simulation — there is no parallel closed-form model for a quantity the
   simulator already produces (the spec's core rule). Aces/DFs come from
   simulated service opportunities; games/sets/tiebreaks from simulated
   scorelines. A single simulation batch feeds all requested markets.
   ========================================================================== */

import { round, clamp } from "@/lib/utils";
import { buildDistribution, type BatchSamples, type SimulationDistribution } from "./simulator";
import { computeFairLine, probMore, probLessPush, type FairLine } from "./fairline";
import { TennisMatchModel, type TennisPlayerInput, type MatchProjectionContext } from "./matchModel";
import { buildModelVersion, type TennisModelVersion } from "./version";

/** The core markets this engine projects (all simulator-derived). */
export type EngineMarket =
  | "aces"
  | "double_faults"
  | "total_games"
  | "games_won"
  | "total_sets"
  | "sets_won"
  | "tie_breaks";

export interface MarketProjection {
  market: EngineMarket;
  line: number;
  projectedMean: number;
  projectedMedian: number;
  standardDeviation: number;
  quantiles: SimulationDistribution;
  probabilityMore: number;
  probabilityLess: number;
  probabilityPush: number;
  fairLine: FairLine;
  /** Coefficient of variation (sd/mean) — dispersion relative to level. */
  volatility: number;
  featureSnapshotId: string;
  simulationVersion: TennisModelVersion;
}

/** Subject-perspective (side A) samples for each market. */
export function samplesForMarket(batch: BatchSamples, market: EngineMarket): number[] {
  switch (market) {
    case "aces": return batch.acesA;
    case "double_faults": return batch.doubleFaultsA;
    case "total_games": return batch.totalGames;
    case "games_won": return batch.gamesWonA;
    case "total_sets": return batch.totalSets;
    case "sets_won": return batch.setsWonA;
    case "tie_breaks": return batch.tiebreaksPlayed;
  }
}

function buildProjection(
  market: EngineMarket,
  line: number,
  samples: number[],
  model: TennisMatchModel,
): MarketProjection {
  const dist = buildDistribution(samples);
  const more = probMore(samples, line);
  const { less, push } = probLessPush(samples, line);
  const volatility = dist.mean > 0 ? round(dist.standardDeviation / dist.mean, 4) : 0;
  return {
    market,
    line,
    projectedMean: round(dist.mean, 3),
    projectedMedian: round(dist.median, 3),
    standardDeviation: round(dist.standardDeviation, 3),
    quantiles: dist,
    probabilityMore: round(more, 4),
    probabilityLess: round(less, 4),
    probabilityPush: round(push, 4),
    fairLine: computeFairLine(samples, line, dist.median, dist.mean),
    volatility: clamp(volatility, 0, 10),
    featureSnapshotId: `${model.a.snapshotId}~${model.b.snapshotId}`,
    simulationVersion: buildModelVersion(model.config),
  };
}

export interface ProjectMarketInput {
  player: TennisPlayerInput;
  opponent: TennisPlayerInput;
  matchContext: MatchProjectionContext;
  line: number;
  market: EngineMarket;
  seed?: string;
  iterations?: number;
}

/** Project a single market (builds + runs one simulation). */
export function projectMarket(input: ProjectMarketInput): { projection: MarketProjection; model: TennisMatchModel } {
  const model = new TennisMatchModel(input.player, input.opponent, input.matchContext);
  const batch = model.simulate({ seed: input.seed, iterations: input.iterations });
  const samples = samplesForMarket(batch, input.market);
  return { projection: buildProjection(input.market, input.line, samples, model), model };
}

export interface ProjectMarketsInput {
  player: TennisPlayerInput;
  opponent: TennisPlayerInput;
  matchContext: MatchProjectionContext;
  /** Line per market. Markets without a line use the simulated median's half-line. */
  lines: Partial<Record<EngineMarket, number>>;
  markets: EngineMarket[];
  seed?: string;
  iterations?: number;
}

/**
 * Batch API: project many markets from ONE simulation batch (efficient — the
 * expensive step is the simulation, shared across markets).
 */
export function projectMarkets(input: ProjectMarketsInput): {
  model: TennisMatchModel;
  batch: BatchSamples;
  projections: Record<string, MarketProjection>;
} {
  const model = new TennisMatchModel(input.player, input.opponent, input.matchContext);
  const batch = model.simulate({ seed: input.seed, iterations: input.iterations });
  const projections: Record<string, MarketProjection> = {};
  for (const market of input.markets) {
    const samples = samplesForMarket(batch, market);
    const dist = buildDistribution(samples);
    const line = input.lines[market] ?? Math.round(dist.median - 0.5) + 0.5;
    projections[market] = buildProjection(market, line, samples, model);
  }
  return { model, batch, projections };
}

/** A serving player's win probability, straight from the simulation. */
export function matchWinProbability(batch: BatchSamples): number {
  return probMore(batch.winnerA.map((x) => x), 0.5); // fraction of winnerA==1
}
