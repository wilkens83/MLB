/* ============================================================================
   Match model — assembles a fully-parameterized structural simulation for a
   specific A-vs-B matchup by wiring the feature builder → serve-point model →
   simulator. This is where features become simulator inputs. Everything is
   shrunk (never null) so the simulator always has usable parameters, while the
   raw feature builders remain available for explainability + data-quality.
   ========================================================================== */

import type { TennisMatch, Surface, Environment, TournamentLevel, DrawRound } from "../domain";
import { DEFAULT_TENNIS_CONFIG, type TennisModelConfig, type TennisScoringRules } from "./config";
import { TennisFeatureBuilder, type FeatureContext, type FeatureWindow } from "./features";
import { servePointWinProb, aceDfProbabilities, type ServeProfile, type ReturnProfile } from "./servePoint";
import { simulateMatches, type SimSides, type BatchSamples, type BatchConfig } from "./simulator";
import { TennisRatingEngine } from "./rating";

export interface TennisPlayerInput {
  id: string;
  /** The player's own completed match history (any state; filtered internally). */
  matches: TennisMatch[];
  ranking?: number;
  previousRanking?: number;
}

export interface MatchProjectionContext {
  asOf: string;
  season: number;
  surface: Surface;
  environment: Environment;
  tourLevel?: TournamentLevel;
  round?: DrawRound;
  bestOf: 3 | 5;
  scoring?: TennisScoringRules;
  window?: FeatureWindow;
  /** Optional rating engine (already replayed). Elos are read strictly before asOf. */
  ratings?: TennisRatingEngine;
  config?: TennisModelConfig;
}

export interface SideDiagnostics {
  sampleSize: number;
  surfaceSampleSize: number;
  servePointWinProb: number;
  aceProb: number;
  dfProb: number;
  overallElo: number;
  surfaceElo: number;
  snapshotId: string;
  serveRates: ReturnType<TennisFeatureBuilder["modelServeRates"]>;
  returnRates: ReturnType<TennisFeatureBuilder["modelReturnRates"]>;
  contextFeatures: ReturnType<TennisFeatureBuilder["contextFeatures"]>;
}

export class TennisMatchModel {
  readonly sides: SimSides;
  readonly rules: TennisScoringRules;
  readonly window: FeatureWindow;
  readonly config: TennisModelConfig;
  readonly a: SideDiagnostics;
  readonly b: SideDiagnostics;
  readonly featureBuilderA: TennisFeatureBuilder;
  readonly featureBuilderB: TennisFeatureBuilder;

  constructor(
    playerA: TennisPlayerInput,
    playerB: TennisPlayerInput,
    ctx: MatchProjectionContext,
  ) {
    this.config = ctx.config ?? DEFAULT_TENNIS_CONFIG;
    this.rules = ctx.scoring ?? { ...this.config.scoring, bestOf: ctx.bestOf };
    this.window = ctx.window ?? "r52";

    const eloA = ctx.ratings?.getPlayerRatingBefore(playerA.id, ctx.asOf, ctx.surface)
      ?? { overallElo: 1500, surfaceElo: 1500, matchesRated: 0 };
    const eloB = ctx.ratings?.getPlayerRatingBefore(playerB.id, ctx.asOf, ctx.surface)
      ?? { overallElo: 1500, surfaceElo: 1500, matchesRated: 0 };

    const fctxA = this.featureContext(ctx, playerA, eloA, eloB, playerB.ranking);
    const fctxB = this.featureContext(ctx, playerB, eloB, eloA, playerA.ranking);
    this.featureBuilderA = new TennisFeatureBuilder(playerA.id, playerA.matches, fctxA, this.config);
    this.featureBuilderB = new TennisFeatureBuilder(playerB.id, playerB.matches, fctxB, this.config);

    const serveA = this.featureBuilderA.modelServeRates(this.window);
    const returnA = this.featureBuilderA.modelReturnRates(this.window);
    const serveB = this.featureBuilderB.modelServeRates(this.window);
    const returnB = this.featureBuilderB.modelReturnRates(this.window);

    const profA: ServeProfile = {
      servicePointsWonPct: serveA.servicePointsWonPct.value!,
      acesPerServiceGame: serveA.acesPerServiceGame.value!,
      dfPerServiceGame: serveA.dfPerServiceGame.value!,
    };
    const profB: ServeProfile = {
      servicePointsWonPct: serveB.servicePointsWonPct.value!,
      acesPerServiceGame: serveB.acesPerServiceGame.value!,
      dfPerServiceGame: serveB.dfPerServiceGame.value!,
    };
    const retA: ReturnProfile = { returnPointsWonPct: returnA.returnPointsWonPct.value! };
    const retB: ReturnProfile = { returnPointsWonPct: returnB.returnPointsWonPct.value! };

    const eloBlendA = 0.5 * eloA.overallElo + 0.5 * eloA.surfaceElo;
    const eloBlendB = 0.5 * eloB.overallElo + 0.5 * eloB.surfaceElo;

    const pAServe = servePointWinProb({ server: profA, returner: retB, surface: ctx.surface, serverElo: eloBlendA, returnerElo: eloBlendB, config: this.config });
    const pBServe = servePointWinProb({ server: profB, returner: retA, surface: ctx.surface, serverElo: eloBlendB, returnerElo: eloBlendA, config: this.config });
    const aceDfA = aceDfProbabilities({ server: profA, returner: retB, surface: ctx.surface, serverElo: eloBlendA, returnerElo: eloBlendB, config: this.config });
    const aceDfB = aceDfProbabilities({ server: profB, returner: retA, surface: ctx.surface, serverElo: eloBlendB, returnerElo: eloBlendA, config: this.config });

    this.sides = {
      a: { pServe: pAServe, aceProb: aceDfA.aceProb, dfProb: aceDfA.dfProb },
      b: { pServe: pBServe, aceProb: aceDfB.aceProb, dfProb: aceDfB.dfProb },
    };

    this.a = this.diagnostics(this.featureBuilderA, this.sides.a, eloA, serveA, returnA);
    this.b = this.diagnostics(this.featureBuilderB, this.sides.b, eloB, serveB, returnB);
  }

  private featureContext(
    ctx: MatchProjectionContext,
    player: TennisPlayerInput,
    self: { overallElo: number; surfaceElo: number },
    opp: { overallElo: number; surfaceElo: number },
    opponentRanking?: number,
  ): FeatureContext {
    return {
      asOf: ctx.asOf,
      season: ctx.season,
      surface: ctx.surface,
      environment: ctx.environment,
      tourLevel: ctx.tourLevel,
      round: ctx.round,
      bestOf: ctx.bestOf,
      opponentStrengthBucket: bucketOfRank(opponentRanking),
      overallElo: self.overallElo,
      surfaceElo: self.surfaceElo,
      opponentOverallElo: opp.overallElo,
      opponentSurfaceElo: opp.surfaceElo,
      ranking: player.ranking,
      previousRanking: player.previousRanking,
    };
  }

  private diagnostics(
    fb: TennisFeatureBuilder,
    side: SimSides["a"],
    elo: { overallElo: number; surfaceElo: number },
    serveRates: ReturnType<TennisFeatureBuilder["modelServeRates"]>,
    returnRates: ReturnType<TennisFeatureBuilder["modelReturnRates"]>,
  ): SideDiagnostics {
    return {
      sampleSize: fb.matchCount(),
      surfaceSampleSize: fb.surfaceMatchCount(),
      servePointWinProb: side.pServe,
      aceProb: side.aceProb,
      dfProb: side.dfProb,
      overallElo: elo.overallElo,
      surfaceElo: elo.surfaceElo,
      snapshotId: fb.snapshotId(this.window),
      serveRates,
      returnRates,
      contextFeatures: fb.contextFeatures(),
    };
  }

  /** Run the batch simulation (deterministic for a given seed). */
  simulate(cfg: BatchConfig = {}): BatchSamples {
    return simulateMatches(this.sides, this.rules, cfg);
  }
}

function bucketOfRank(rank?: number): number {
  if (rank === undefined) return 3;
  if (rank <= 10) return 0;
  if (rank <= 30) return 1;
  if (rank <= 70) return 2;
  return 3;
}
