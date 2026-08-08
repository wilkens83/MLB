/* Public surface of the Tennis data-acquisition workflow. */

export {
  buildTennisAcquisitionWorkflow, runTennisAcquisitionWorkflow,
  TENNIS_ACQUISITION_WORKFLOW_ID, type TennisAcquisitionRun,
} from "./workflow";
export {
  tennisAcquisitionInputSchema, acquisitionResultSchema,
  type TennisAcquisitionInput, type TennisAcquisitionDeps, type AcquisitionResult,
} from "./types";
