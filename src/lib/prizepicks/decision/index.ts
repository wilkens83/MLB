/* Firm PrizePicks decision engine — public surface. */

export * from "./types";
export { DEFAULT_DECISION_POLICY } from "./policy";
export { DECISION_ENGINE_VERSION, configChecksum } from "./version";
export { VETO, reason, veto } from "./reasons";
export { computeLegGates, type LegFacts, type GateResult } from "./veto";
export { evaluateLeg, type LegEvaluation } from "./evaluate-leg";
export { evaluateEntry, type EntryFacts, type EntryEconomicsFacts, type EntryDecision } from "./evaluate-entry";
export { runSensitivity, type SensitivityInput, type SensitivityResult } from "./sensitivity";
export {
  deriveMarketValidationState, DEFAULT_VALIDATION_CONFIG,
  type MarketValidationInput, type MarketValidationConfig,
} from "./market-validation";
