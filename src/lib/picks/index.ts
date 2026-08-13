/* Public surface of the Player Picks layer. Everything is built on the existing
   engine (`runAnalysis`) — this layer only screens and ranks. */

export * from "./types";
export { eligibleProps } from "./eligible";
export { probsFromDistribution, analyzeAltLines, fragilityProxy } from "./distribution";
export { decidePick, buildExplanation, projectionStatus, projectionScore, DEFAULT_PICKS_POLICY, type PicksPolicy } from "./decide";
export { rankPicks, comparePicks, type RankedPicks } from "./rank";
export { analyzePlayerPicks, type AnalyzePlayerPicksInput, type PicksDeps } from "./orchestrator";
export {
  runPickSelector, scorePick, edgeOf, fromDecisionResult,
  DEFAULT_SELECTOR_FILTERS, SELECTOR_SCORE_VERSION,
  type SelectorCandidate, type PickSelectorFilters, type PickSelectorResult,
  type GradedPick, type PickGrade, type PickTier, type SelectorSummary,
} from "./selector";
