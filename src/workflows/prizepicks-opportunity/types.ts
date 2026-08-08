/* Contracts for prizepicks-opportunity@1. The graph gathers facts via injected
   providers (projection, sensitivity, calibration, trusted scientific facts) and
   the terminal node runs the Opportunity Engine over them. Providers are injected
   so the graph is deterministically testable offline. Pure (zod + domain types). */

import { z } from "zod";
import type { CanonicalLineSnapshot } from "@/lib/prizepicks/ingestion/snapshot";
import type { CalibrationModel } from "@/lib/prizepicks/opportunity/calibration";
import type { MarketValidationState } from "@/lib/prizepicks/decision/types";
import type { OpportunityStore } from "@/lib/prizepicks/opportunity/store";

export const opportunityInputSchema = z.object({
  line: z.custom<CanonicalLineSnapshot>((v) => typeof v === "object" && v !== null),
});
export type OpportunityWorkflowInput = z.infer<typeof opportunityInputSchema>;

export interface ProjectionFacts {
  isPitcher: boolean;
  rawProbabilityMore: number;
  rawProbabilityLess: number;
  rawProbabilityPush: number;
  projectionMean: number;
  projectionMedian: number;
  dataQuality: number;
  volatility: number;
  uncertaintyLow: number;
  uncertaintyHigh: number;
  /** Simulation iterations behind the probabilities (for Monte-Carlo error). */
  iterations?: number;
  /** Fraction of expected inputs present, 0..1 (completeness, not quality). */
  dataCompleteness?: number;
}

export interface SensitivityFacts {
  fragility: number;
  worstCaseSelectedProbability?: number;
  // Full fragility summary (from runFragilityAnalysis) — optional/additive.
  fragilityLevel?: "LOW" | "MODERATE" | "HIGH" | "EXTREME";
  scenarioProbabilities?: { label: string; assumption: string; probability: number }[];
  probabilityRange?: number;
  medianScenarioProbability?: number;
  directionFlipCount?: number;
  directionUnstable?: boolean;
}

export interface PregameFacts {
  pregameSnapshotExists: boolean;
  snapshotBeforeEvent: boolean;
  featureCutoffBeforeStart: boolean;
  gameStarted: boolean;
}

export interface ScientificFacts {
  marketValidationState: MarketValidationState;
  calibrationDegraded: boolean;
  featureDriftExceeded: boolean;
  outsideTrainingSupport: boolean;
  requiredSimDependencyUnavailable: boolean;
  trainingSupport: number;
  playerResolved: boolean;
  gameResolved: boolean;
  doubleheaderAmbiguous?: boolean;
  marketSupported: boolean;
  invalidLine?: boolean;
  lineupRequired: boolean;
  lineupConfirmed: boolean;
  pitcherMateriallyRelevant: boolean;
  starterConfirmed: boolean;
  lineAgeMinutes?: number;
  modelVersionApproved: boolean;
  modelVersion: string;
  featureVersion: string;
}

export interface OpportunityDeps {
  loadPregame(lineSnapshotId: string): Promise<PregameFacts>;
  getProjection(args: { market: string; line: number; playerId?: number; gamePk?: number }): Promise<ProjectionFacts>;
  getSensitivity(args: { market: string; line: number; isPitcher: boolean; side: "more" | "less" }): Promise<SensitivityFacts>;
  getCalibration(args: { market: string; modelVersion: string }): Promise<CalibrationModel>;
  getScientificFacts(args: { market: string; playerId?: number; gamePk?: number; capturedAt: string }): Promise<ScientificFacts>;
  store: OpportunityStore;
}

/** Node outputs that carry rich in-memory objects use z.custom (parsed as-is). */
export const anyFacts = z.object({ facts: z.custom<unknown>() });
