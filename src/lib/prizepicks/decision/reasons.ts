/* Reason + veto builders and their stable codes. Codes are stable strings so
   decisions can be audited and aggregated over time. */

import type { DecisionReason, DecisionVeto, ReasonCategory } from "./types";

export function reason(
  code: string,
  category: ReasonCategory,
  severity: DecisionReason["severity"],
  message: string,
  actualValue?: DecisionReason["actualValue"],
  requiredValue?: DecisionReason["requiredValue"],
): DecisionReason {
  return { code, category, severity, message, actualValue, requiredValue };
}

export function veto(code: string, message: string): DecisionVeto {
  return { code, message, blocking: true };
}

/** Stable veto codes (BET_MORE/BET_LESS become impossible when any is present). */
export const VETO = {
  PLAYER_UNRESOLVED: "PLAYER_UNRESOLVED",
  GAME_UNRESOLVED: "GAME_UNRESOLVED",
  DOUBLEHEADER_AMBIGUOUS: "DOUBLEHEADER_AMBIGUOUS",
  GAME_STARTED: "GAME_STARTED",
  SNAPSHOT_AFTER_START: "SNAPSHOT_AFTER_START",
  FUTURE_DATA_LEAKAGE: "FUTURE_DATA_LEAKAGE",
  LINEUP_UNCONFIRMED: "LINEUP_UNCONFIRMED",
  PITCHER_UNCONFIRMED: "PITCHER_UNCONFIRMED",
  MARKET_UNSUPPORTED: "MARKET_UNSUPPORTED",
  LINE_STALE: "LINE_STALE",
  PAYOUT_TABLE_MISSING: "PAYOUT_TABLE_MISSING",
  PAYOUT_UNVERIFIED: "PAYOUT_UNVERIFIED",
  ENTRY_EV_UNAVAILABLE: "ENTRY_EV_UNAVAILABLE",
  ENTRY_EV_BELOW_MIN: "ENTRY_EV_BELOW_MIN",
  PROVIDER_CONFLICT: "PROVIDER_CONFLICT",
  DATA_QUALITY_FLOOR: "DATA_QUALITY_FLOOR",
  FRAGILITY_CEILING: "FRAGILITY_CEILING",
  CONTRADICTORY_SIMULATION: "CONTRADICTORY_SIMULATION",
  UNMODELED_CORRELATION: "UNMODELED_CORRELATION",
  MODEL_VERSION_UNAPPROVED: "MODEL_VERSION_UNAPPROVED",
  PIPELINE_INTEGRITY: "PIPELINE_INTEGRITY",
  MARKET_SUSPENDED: "MARKET_SUSPENDED",
  MARKET_RESEARCH_ONLY: "MARKET_RESEARCH_ONLY",
  MARKET_NOT_ELIGIBLE: "MARKET_NOT_ELIGIBLE",
  CIRCUIT_BREAKER: "CIRCUIT_BREAKER",
  BOTH_SIDES_QUALIFY: "BOTH_SIDES_QUALIFY",
} as const;
