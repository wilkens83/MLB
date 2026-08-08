/* ============================================================================
   Opportunity querying + presentation. The chat asks "which lines are strongest?"
   by querying CanonicalOpportunityAssessments — NOT raw projections — and ranking
   ONLY currently-eligible candidates. This is pure: given assessments it filters,
   ranks, and maps them to a display row that keeps raw and calibrated probability
   DISTINCT and never fabricates a qualifying pick.
   ========================================================================== */

import type { CanonicalOpportunityAssessment, OpportunityStatus } from "./types";

export type OpportunityStatusFilter = "QUALIFIED" | "WATCH" | "REJECTED" | "ANY";
export type OpportunitySort = "advantage" | "calibrated" | "fragility";

export interface OpportunityQuery {
  status?: OpportunityStatusFilter; // default QUALIFIED
  market?: string;
  side?: "more" | "less";
  sortBy?: OpportunitySort;
  limit?: number;
}

/** A chat-facing row. Raw and calibrated are separate; missing provenance stays
    null — never invented. */
export interface OpportunityRow {
  lineSnapshotId: string;
  playerId?: number;
  gamePk?: number;
  market: string;
  line: number;
  side: "more" | "less";
  status: OpportunityStatus;
  /** Calibrated probability for the side — null when calibration is unavailable. */
  calibratedProbability: number | null;
  /** Raw model probability for the side — NEVER labeled "calibrated". */
  rawProbability: number;
  baselineProbability: number | null;
  modelAdvantage: number | null;
  uncertaintyLow: number;
  uncertaintyHigh: number;
  fragility: number;
  fragilityLevel?: string;
  dataQuality: number;
  modelLifecycleState: string;
  primaryReasons: string[];
  scientificVetoes: { code: string; message: string }[];
  // provenance — always present on the canonical record
  dataTimestamp: string;
  modelVersion: string;
  calibrationVersion: string;
  featureVersion: string;
}

function statusMatches(status: OpportunityStatus, filter: OpportunityStatusFilter): boolean {
  switch (filter) {
    case "QUALIFIED": return status === "QUALIFIED_MORE" || status === "QUALIFIED_LESS";
    case "WATCH": return status === "WATCH";
    case "REJECTED": return status === "NO_PLAY" || status === "UNAVAILABLE";
    case "ANY": return true;
  }
}

function sideOf(a: CanonicalOpportunityAssessment): "more" | "less" {
  if (a.status === "QUALIFIED_MORE") return "more";
  if (a.status === "QUALIFIED_LESS") return "less";
  return a.side ?? (a.rawProbabilityMore >= a.rawProbabilityLess ? "more" : "less");
}

export function describeOpportunityRow(a: CanonicalOpportunityAssessment): OpportunityRow {
  const side = sideOf(a);
  const calibrated = side === "more" ? a.calibratedProbabilityMore : a.calibratedProbabilityLess;
  const raw = side === "more" ? a.rawProbabilityMore : a.rawProbabilityLess;
  return {
    lineSnapshotId: a.lineSnapshotId, playerId: a.playerId, gamePk: a.gamePk,
    market: a.market, line: a.line, side, status: a.status,
    calibratedProbability: a.calibrationAvailable && calibrated !== undefined ? calibrated : null,
    rawProbability: raw,
    baselineProbability: a.baselineProbability ?? null,
    modelAdvantage: a.modelAdvantage ?? null,
    uncertaintyLow: a.uncertaintyLow, uncertaintyHigh: a.uncertaintyHigh,
    fragility: a.fragility, fragilityLevel: a.fragilityLevel,
    dataQuality: a.dataQuality, modelLifecycleState: a.modelLifecycleState,
    primaryReasons: a.reasonCodes.slice(0, 4),
    scientificVetoes: a.scientificVetoes,
    dataTimestamp: a.generatedAt, modelVersion: a.modelVersion,
    calibrationVersion: a.calibrationVersion, featureVersion: a.featureVersion,
  };
}

/** Filter + rank assessments into chat rows. Defaults to QUALIFIED candidates,
    ranked by model advantage. Never returns a fabricated pick. */
export function rankOpportunities(
  assessments: CanonicalOpportunityAssessment[],
  query: OpportunityQuery = {},
): OpportunityRow[] {
  const status = query.status ?? "QUALIFIED";
  const sortBy = query.sortBy ?? "advantage";
  const rows = assessments
    .filter((a) => statusMatches(a.status, status))
    .filter((a) => (query.market ? a.market === query.market : true))
    .map(describeOpportunityRow)
    .filter((r) => (query.side ? r.side === query.side : true));

  rows.sort((x, y) => {
    if (sortBy === "fragility") return x.fragility - y.fragility; // lowest first
    if (sortBy === "calibrated") return (y.calibratedProbability ?? -1) - (x.calibratedProbability ?? -1);
    return (y.modelAdvantage ?? -Infinity) - (x.modelAdvantage ?? -Infinity); // advantage
  });

  return query.limit && query.limit > 0 ? rows.slice(0, query.limit) : rows;
}
