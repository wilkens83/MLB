/* Public surface of the prizepicks-opportunity@1 workflow. */

export {
  buildOpportunityWorkflow, runOpportunityWorkflow, PRIZEPICKS_OPPORTUNITY_WORKFLOW_ID, type OpportunityRun,
} from "./workflow";
export { opportunityInputSchema, type OpportunityDeps } from "./types";
