/* ============================================================================
   Parallel-model contracts. Diamond Edge runs several DETERMINISTIC statistical
   models over the same prop and combines them — it never asks an LLM for a
   probability. Each model reuses the existing pure engine (`project`, `simulate`,
   `simulatePlateAppearances`); this layer only standardizes their outputs, blends
   them (ensemble), and measures how much they disagree.

   Versions are explicit so a coefficient/topology/weight change is traceable in
   every snapshot (see docs/graph-engineering/DATA_PROVENANCE.md).
   ========================================================================== */

import type { DistributionBucket } from "@/lib/prediction/simulate";

export const MODEL_ENSEMBLE_VERSION = "1.0.0";

/** Model ids in this ensemble. `pa` is only present for PA-modeled batter props. */
export type ModelId = "marginal" | "pa" | "baseline";

/** Standardized output of ONE statistical model for one prop+line. */
export interface ModelOutput {
  id: ModelId;
  modelVersion: string;
  /** Expected value (mean) for the game in prop units. */
  projection: number;
  probOver: number;
  probUnder: number;
  probPush: number;
  distribution?: DistributionBucket[];
  sampleSize: number;
  warnings: string[];
  metadata: Record<string, unknown>;
}

/** Configurable, versioned ensemble weights. Renormalized over present models. */
export const MODEL_WEIGHTS: Record<ModelId, number> = {
  pa: 0.5,
  marginal: 0.35,
  baseline: 0.15,
};

export interface EnsembleContribution {
  id: ModelId;
  weight: number; // effective (renormalized) weight actually used
  probOver: number;
  projection: number;
}

export interface EnsembleOutput {
  rawProbOver: number;
  rawProbUnder: number;
  rawProbPush: number;
  /** Weighted-mean projection across present models. */
  projection: number;
  /** Effective weights after renormalizing over present models. */
  weights: Partial<Record<ModelId, number>>;
  contributions: EnsembleContribution[];
  version: string;
  warnings: string[];
}

export type DisagreementSeverity = "low" | "medium" | "high";

/** Deterministic spread across model probabilities/projections. */
export interface ModelDisagreement {
  /** max−min of the models' probOver. */
  probabilityRange: number;
  /** max−min of the models' projection. */
  projectionRange: number;
  /** population std-dev of the models' probOver. */
  stdDevProbability: number;
  severity: DisagreementSeverity;
  modelCount: number;
}

export interface ModelEnsembleResult {
  models: ModelOutput[];
  ensemble: EnsembleOutput;
  disagreement: ModelDisagreement;
}
