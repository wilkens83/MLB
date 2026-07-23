/* ============================================================================
   Tennis domain enumerations. Kept as string-literal unions (not TS enums) so
   they are erasable, tree-shakeable, and usable in the browser and under Bun.
   ========================================================================== */

/** Professional tours Diamond Edge models. */
export type TennisTour = "atp" | "wta" | "challenger" | "itf";

/** Court surface — the single biggest structural factor in tennis modeling. */
export type Surface = "hard" | "clay" | "grass" | "carpet";

/** Indoor/outdoor materially changes serve dominance and conditions. */
export type Environment = "indoor" | "outdoor" | "unknown";

/** Match format. Grand Slam men's is best-of-5; almost everything else best-of-3. */
export type MatchFormat = "best_of_3" | "best_of_5";

/** Handedness — affects matchup dynamics (lefty serve slice, etc.). */
export type Plays = "right" | "left" | "unknown";

export type Backhand = "one_handed" | "two_handed" | "unknown";

/** Tournament tier / draw level, normalized across tours. */
export type TournamentLevel =
  | "grand_slam"
  | "atp_1000"
  | "atp_500"
  | "atp_250"
  | "wta_1000"
  | "wta_500"
  | "wta_250"
  | "challenger"
  | "itf"
  | "other";

/** Lifecycle state of a match. */
export type MatchState = "scheduled" | "live" | "completed" | "retired" | "walkover" | "cancelled";

/**
 * Round within a tournament draw, normalized. Used for weighting and context.
 */
export type DrawRound =
  | "qualifying"
  | "r128"
  | "r64"
  | "r32"
  | "r16"
  | "quarterfinal"
  | "semifinal"
  | "final";

/**
 * Tennis betting markets Diamond Edge supports. These are structural — most are
 * produced by the point→game→set→match Monte Carlo (Phase 6) and summarized via
 * the shared `summarizeSamples`, not drawn from a closed-form family.
 */
export type TennisMarketKey =
  | "match_winner" // moneyline
  | "set_winner" // winner of a specific set
  | "total_games" // over/under total games in the match
  | "total_sets" // over/under number of sets played
  | "set_handicap" // games handicap
  | "player_games_won" // a player's total games won
  | "aces" // a player's aces
  | "double_faults" // a player's double faults
  | "tiebreak_in_match" // yes/no a tiebreak occurs
  | "exact_score"; // exact set score (2-0, 2-1, …)
