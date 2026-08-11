/* Public surface of the Reddit research layer. Reddit is an early-warning/context
   source only — nothing here ever modifies a model probability. */

export * from "./types";
export { generatePlayerQueries, relevantSubreddits } from "./queries";
export { classifyItem, classifyItems, isSpam, type ClassifiedItem } from "./classify";
export { clusterEvents, type EventCluster } from "./dedupe";
export { assessCredibility } from "./credibility";
export { verifyEvent, type VerificationContext, type Verdict } from "./verify";
export { computeSentiment } from "./sentiment";
export { computeTrend, minutesSince } from "./trend";
export { buildPlayerResearch } from "./engine";
export { contextEventsToFeatures } from "./features";
export {
  InMemoryContextEventStore, getContextEventStore, type ContextEventStore,
} from "./store";
export { SupabaseContextEventStore } from "./supabase-store";
export { redditResearchProvider, disabledRedditProvider } from "./provider";
export {
  evaluateContextPredictiveValue,
  type ContextObservation, type EventTypeEvaluation, type ContextEvaluationReport, type EvaluationConfig,
} from "./evaluate";
