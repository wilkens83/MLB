/* ============================================================================
   Removal / hook hazard. After each batter faced the simulator asks: is the
   starter pulled before the NEXT batter? The hazard rises with pitch count,
   poor performance (runs/baserunners), depth (times through the order) and
   recent workload — a transparent, versioned, testable logistic. Manager
   behavior is uncertain, so this is a PROBABILITY, never a hard "100 pitches =
   out" rule. Pure + deterministic given a seed.
   ========================================================================== */

export const REMOVAL_MODEL_VERSION = "removal-1.0.0";

/** In-game state evaluated after a batter faced. */
export interface RemovalState {
  pitchCount: number;
  battersFaced: number;
  outs: number;
  runsAllowed: number;
  baserunners: number; // currently on base (pressure to pull)
  timesThroughOrder: number;
}

/** Versioned hazard coefficients (documented, not tuned in-mission). */
export interface RemovalParams {
  /** Pitch budget the manager is planning around (from recent workload). */
  targetPitches: number;
  /** Hard cap — removal is (near) certain beyond this many pitches. */
  hardCapPitches: number;
  /** Hard cap on batters faced (safety bound). */
  maxBattersFaced: number;
  intercept: number;
  perPitchOverSoftCap: number;
  softCapOffset: number; // soft cap = targetPitches - softCapOffset
  perRun: number;
  perBaserunner: number;
  perTtoOver2: number;
  perOutAfter15: number;
}

export const DEFAULT_REMOVAL_PARAMS: Omit<RemovalParams, "targetPitches" | "hardCapPitches" | "maxBattersFaced"> = {
  // Calibrated so a healthy starter (target ~90 pitches) goes ~6 IP: near-zero
  // base hazard (per-BF hazard compounds over ~25 batters, so the intercept must
  // stay small) with a steep pitch-count ramp near the budget. Performance and
  // times-through-order ADD to the hazard but never dominate a fresh outing —
  // managers do not pull a starter for a lone baserunner in the 3rd.
  intercept: -6.5,
  perPitchOverSoftCap: 0.28,
  softCapOffset: 12, // soft cap = target - 12
  perRun: 0.15,
  perBaserunner: 0.03,
  perTtoOver2: 0.4,
  perOutAfter15: 0.0,
};

function sigmoid(x: number): number {
  return 1 / (1 + Math.exp(-x));
}

/**
 * Per-batter removal probability. Returns the hazard plus the dominant driver
 * (for honest "hook reason" reporting). Beyond the hard caps the hazard is 1.
 */
export function removalHazard(
  state: RemovalState,
  params: RemovalParams,
): { hazard: number; reason: "pitchCount" | "performance" | "capped" } {
  if (state.pitchCount >= params.hardCapPitches || state.battersFaced >= params.maxBattersFaced) {
    return { hazard: 1, reason: "capped" };
  }
  const softCap = params.targetPitches - params.softCapOffset;
  const pitchTerm = params.perPitchOverSoftCap * Math.max(0, state.pitchCount - softCap);
  const runTerm = params.perRun * state.runsAllowed + params.perBaserunner * state.baserunners;
  const ttoTerm = params.perTtoOver2 * Math.max(0, state.timesThroughOrder - 2);
  const outTerm = params.perOutAfter15 * Math.max(0, state.outs - 15);

  const z = params.intercept + pitchTerm + runTerm + ttoTerm + outTerm;
  const hazard = sigmoid(z);
  // Attribute the dominant contribution for observability.
  const reason = pitchTerm >= runTerm && pitchTerm >= ttoTerm ? "pitchCount" : "performance";
  return { hazard, reason };
}

/** Build removal params from a workload budget + the versioned coefficients. */
export function buildRemovalParams(targetPitches: number, maxBattersFaced = 34): RemovalParams {
  return {
    targetPitches,
    hardCapPitches: Math.round(targetPitches + 25),
    maxBattersFaced,
    ...DEFAULT_REMOVAL_PARAMS,
  };
}
