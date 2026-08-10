/* Public surface of the parallel-model layer. */
export { computeModelEnsemble } from "./runModels";
export { baselineModel, BASELINE_MODEL_VERSION } from "./baseline";
export { buildEnsemble } from "./ensemble";
export { computeDisagreement, DEFAULT_DISAGREEMENT_THRESHOLDS } from "./disagreement";
export {
  MODEL_WEIGHTS, MODEL_ENSEMBLE_VERSION,
  type ModelId, type ModelOutput, type EnsembleOutput, type EnsembleContribution,
  type ModelDisagreement, type DisagreementSeverity, type ModelEnsembleResult,
} from "./types";
