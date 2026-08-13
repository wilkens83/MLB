/* ============================================================================
   Player role — a first-class, typed contract for WHAT a player is doing today,
   distinct from what they are on the roster. A pitcher being rostered is NOT the
   same as being today's starting pitcher; the six-prop joint-START simulation is
   only defensible for a pitcher who actually starts. Roles are resolved from
   already-available signals (the game's probable-pitcher fields) and degrade to
   an explicit UNKNOWN — never a silent assumption — when the signal is absent.

   Pure + dependency-free: no I/O, no fabrication. When the input evidence does
   not determine a role, the result says so (confidence "none"/"low") so the
   uncertainty can propagate into warnings and decision quality rather than being
   hidden behind a false "starter" label.
   ========================================================================== */

export type PlayerRole =
  | "STARTING_PITCHER"
  | "RELIEF_PITCHER"
  | "UNKNOWN_PITCHER_ROLE"
  | "STARTING_HITTER"
  | "BENCH"
  | "UNKNOWN_HITTER_ROLE";

export type RoleConfidence = "confirmed" | "probable" | "assumed" | "none";

export interface RoleResolution {
  role: PlayerRole;
  confidence: RoleConfidence;
  /** True only when a start is actually indicated (or defensibly assumed). */
  isStarter: boolean;
  /** Whether a start-based model (joint pitcher sim / PA sim) is appropriate. */
  startModelApplies: boolean;
  /** Honest, human-readable note carrying the assumption/uncertainty. */
  note: string;
}

export interface PitcherRoleSignals {
  playerId: number;
  /** The analyzed pitcher's OWN team probable-starter id for today's game. */
  ownProbablePitcherId?: number;
  /** True once MLB posts the confirmed starter (vs a projected probable). */
  starterConfirmed?: boolean;
  /** No game resolved for the player's team today. */
  noGameResolved?: boolean;
}

/**
 * Classify the analyzed pitcher's role for today from the game's probable-starter
 * signal. The key correctness point: when a probable starter IS posted and it is
 * NOT this pitcher, they are the bullpen — the start model does not apply. When
 * no probable is posted we ASSUME a start (the common case for prop analysis) but
 * label it explicitly so the assumption is visible.
 */
export function classifyPitcherRole(s: PitcherRoleSignals): RoleResolution {
  if (s.noGameResolved) {
    return {
      role: "UNKNOWN_PITCHER_ROLE",
      confidence: "none",
      isStarter: false,
      startModelApplies: true, // analysis proceeds under an explicit start assumption
      note: "No game resolved for this pitcher's team today — start assumed, not confirmed.",
    };
  }
  if (s.ownProbablePitcherId === undefined) {
    return {
      role: "UNKNOWN_PITCHER_ROLE",
      confidence: "assumed",
      isStarter: true,
      startModelApplies: true,
      note: "No probable starter posted yet — modeled as a starter (assumption, not confirmed).",
    };
  }
  if (s.ownProbablePitcherId === s.playerId) {
    return {
      role: "STARTING_PITCHER",
      confidence: s.starterConfirmed ? "confirmed" : "probable",
      isStarter: true,
      startModelApplies: true,
      note: s.starterConfirmed
        ? "Confirmed starting pitcher."
        : "Probable starting pitcher (not yet confirmed by MLB).",
    };
  }
  // A probable starter is posted and it is someone else → this pitcher is relief.
  return {
    role: "RELIEF_PITCHER",
    confidence: s.starterConfirmed ? "confirmed" : "probable",
    isStarter: false,
    startModelApplies: false,
    note: "Not today's probable starter — the start-based projection does not apply to a relief appearance.",
  };
}

export interface HitterRoleSignals {
  /** Whether the hitter appears in today's (projected or confirmed) lineup. */
  inLineup?: boolean;
  lineupConfirmed?: boolean;
  noGameResolved?: boolean;
}

/**
 * Classify a hitter's role. Lineup membership is only known ~1–2h pregame; when
 * it is unknown we do NOT assert "starting" — we return UNKNOWN and proceed under
 * an explicit assumption so projected-vs-confirmed uncertainty stays visible.
 */
export function classifyHitterRole(s: HitterRoleSignals): RoleResolution {
  if (s.noGameResolved) {
    return {
      role: "UNKNOWN_HITTER_ROLE",
      confidence: "none",
      isStarter: false,
      startModelApplies: true,
      note: "No game resolved for this hitter's team today — start assumed, not confirmed.",
    };
  }
  if (s.inLineup === true) {
    return {
      role: "STARTING_HITTER",
      confidence: s.lineupConfirmed ? "confirmed" : "probable",
      isStarter: true,
      startModelApplies: true,
      note: s.lineupConfirmed ? "Confirmed in the starting lineup." : "Projected in the starting lineup (not confirmed).",
    };
  }
  if (s.inLineup === false) {
    return {
      role: "BENCH",
      confidence: s.lineupConfirmed ? "confirmed" : "probable",
      isStarter: false,
      startModelApplies: false,
      note: "Not in the (projected) starting lineup — full-game plate-appearance opportunity does not apply.",
    };
  }
  return {
    role: "UNKNOWN_HITTER_ROLE",
    confidence: "assumed",
    isStarter: true,
    startModelApplies: true,
    note: "Lineup not yet posted — modeled as a starter (assumption, not confirmed).",
  };
}
