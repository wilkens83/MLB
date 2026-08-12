/* Public surface of the Player Picks layer. Everything is built on the existing
   engine (`runAnalysis`) — this layer only screens and ranks. */

export * from "./types";
export { eligibleProps } from "./eligible";
export { probsFromDistribution, analyzeAltLines, fragilityProxy } from "./distribution";
export { decidePick, buildExplanation, projectionStatus, projectionScore, DEFAULT_PICKS_POLICY, type PicksPolicy } from "./decide";
export { rankPicks, comparePicks, type RankedPicks } from "./rank";
export { analyzePlayerPicks, type AnalyzePlayerPicksInput, type PicksDeps } from "./orchestrator";
