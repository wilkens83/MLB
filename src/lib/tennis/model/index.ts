/* ============================================================================
   Tennis quantitative engine — public surface.
   ========================================================================== */

export * from "./config";
export * from "./version";
export {
  TennisFeatureBuilder,
  type FeatureValue, type FeatureWindow, type FeatureContext,
} from "./features";
export {
  TennisRatingEngine, DEFAULT_ELO_CONFIG, expected,
  type EloConfig, type TennisRatingSnapshot, type MatchWinContext,
} from "./rating";
export {
  servePointWinProb, aceDfProbabilities,
  type ServeProfile, type ReturnProfile, type ServePointInputs,
} from "./servePoint";
export {
  simulateMatch, simulateMatches, buildDistribution,
  playPoint, playGame, playTiebreak, playSet,
  type MatchOutcome, type SimSides, type ServeParams, type BatchSamples,
  type SimulationDistribution, type BatchConfig,
  type PointResult, type GameTally, type TiebreakTally, type SetTally,
} from "./simulator";
export {
  TennisMatchModel,
  type TennisPlayerInput, type MatchProjectionContext, type SideDiagnostics,
} from "./matchModel";
export {
  projectMarket, projectMarkets, samplesForMarket, matchWinProbability,
  type EngineMarket, type MarketProjection, type ProjectMarketInput, type ProjectMarketsInput,
} from "./markets";
export {
  computeFairLine, probMore, probLessPush, type FairLine,
} from "./fairline";
export {
  assess,
  type TennisPredictionAssessment, type Recommendation, type PredictionReason, type AssessmentOptions,
} from "./assessment";
