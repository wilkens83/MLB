/* Human-readable labels for opportunity reason/veto codes shown in the decision
   block. Unknown codes fall back to a de-slugged form — never hidden. */

const LABELS: Record<string, string> = {
  OPPORTUNITY_QUALIFIED: "Calibrated probability clears the policy threshold",
  CALIBRATION_UNAVAILABLE: "No fitted calibration for this market/model version",
  PROBABILITY_BELOW_MIN: "Selected-side probability below the policy minimum",
  NO_MODEL_ADVANTAGE: "Model does not beat the independent baseline",
  MARKET_NOT_VALIDATED: "Market model is not in a BET-eligible lifecycle state",
  PAYOUT_UNVERIFIED: "Payout economics are generic/unverified",
  LINEUP_UNCONFIRMED: "Lineup not yet confirmed (projected)",
  STARTER_UNCONFIRMED: "Opposing starter not confirmed (projected)",
  NO_PREGAME_SNAPSHOT: "No immutable pregame snapshot captured for this line",
  GAME_STARTED: "Game has already started",
  FEATURE_DRIFT: "Input-distribution drift exceeds the safe threshold",
  OUTSIDE_TRAINING_SUPPORT: "Inputs fall outside the model's training support",
  CALIBRATION_DEGRADED: "Calibration quality is degraded",
  MISSING_SIM_DEPENDENCY: "A required simulation dependency is unavailable",
  PLAYER_UNRESOLVED: "Player could not be resolved to a canonical id",
  GAME_UNRESOLVED: "No game resolved for this player today",
  MARKET_UNSUPPORTED: "Market is not supported by the engine",
  INVALID_LINE: "Line is invalid for this market",
  LOW_DATA_QUALITY: "Data quality is below the policy floor",
  HIGH_FRAGILITY: "Projection is fragile under plausible assumptions",
  DIRECTION_UNSTABLE: "Preferred side flips under plausible assumptions",
};

export function labelForCode(code: string): string {
  return LABELS[code] ?? code.toLowerCase().replace(/_/g, " ").replace(/^\w/, (c) => c.toUpperCase());
}
