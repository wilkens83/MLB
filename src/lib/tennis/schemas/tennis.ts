/* ============================================================================
   Zod schemas for the tennis provider boundary. Providers validate their mapped
   payloads against these before handing them to the engine, so malformed or
   partial upstream data degrades gracefully (via `safeValidate`) instead of
   crashing the pipeline. Mirrors `src/lib/schemas/mlb.ts`.

   These describe the NORMALIZED domain shapes — a provider maps its raw response
   into these, then validates. Raw provider shapes are validated inside each
   adapter with adapter-local schemas.
   ========================================================================== */

import { z } from "zod";

export const zTennisTour = z.enum(["atp", "wta", "challenger", "itf"]);
export const zSurface = z.enum(["hard", "clay", "grass", "carpet"]);
export const zEnvironment = z.enum(["indoor", "outdoor", "unknown"]);
export const zMatchFormat = z.enum(["best_of_3", "best_of_5"]);
export const zPlays = z.enum(["right", "left", "unknown"]);
export const zBackhand = z.enum(["one_handed", "two_handed", "unknown"]);
export const zMatchState = z.enum([
  "scheduled", "live", "completed", "retired", "walkover", "cancelled",
]);
export const zDrawRound = z.enum([
  "qualifying", "r128", "r64", "r32", "r16", "quarterfinal", "semifinal", "final",
]);

export const zTennisPlayer = z.object({
  id: z.string().min(1),
  fullName: z.string().min(1),
  normalizedName: z.string().min(1),
  tour: zTennisTour,
  countryCode: z.string().optional(),
  dateOfBirth: z.string().optional(),
  plays: zPlays,
  backhand: zBackhand,
  heightCm: z.number().positive().optional(),
  turnedProYear: z.number().int().optional(),
  externalIds: z.record(z.string(), z.string()),
});

export const zRankingSnapshot = z.object({
  playerId: z.string().min(1),
  tour: zTennisTour,
  asOf: z.string().min(1),
  rank: z.number().int().positive(),
  points: z.number().nonnegative().optional(),
  raceRank: z.number().int().positive().optional(),
});

export const zTournament = z.object({
  id: z.string().min(1),
  name: z.string().min(1),
  tour: zTennisTour,
  level: z.enum([
    "grand_slam", "atp_1000", "atp_500", "atp_250",
    "wta_1000", "wta_500", "wta_250", "challenger", "itf", "other",
  ]),
  surface: zSurface,
  environment: zEnvironment,
  city: z.string().optional(),
  countryCode: z.string().optional(),
  altitudeM: z.number().optional(),
  startDate: z.string().optional(),
  endDate: z.string().optional(),
  season: z.number().int(),
  externalIds: z.record(z.string(), z.string()),
});

export const zSetScore = z.object({
  homeGames: z.number().int().nonnegative(),
  awayGames: z.number().int().nonnegative(),
  homeTiebreak: z.number().int().nonnegative().optional(),
  awayTiebreak: z.number().int().nonnegative().optional(),
});

export const zMatchStatLine = z.object({
  playerId: z.string().min(1),
  aces: z.number().int().nonnegative().optional(),
  doubleFaults: z.number().int().nonnegative().optional(),
  firstServePct: z.number().min(0).max(1).optional(),
  firstServeWonPct: z.number().min(0).max(1).optional(),
  secondServeWonPct: z.number().min(0).max(1).optional(),
  breakPointsFaced: z.number().int().nonnegative().optional(),
  breakPointsSaved: z.number().int().nonnegative().optional(),
  breakPointsConverted: z.number().int().nonnegative().optional(),
  serviceGamesPlayed: z.number().int().nonnegative().optional(),
  serviceGamesWon: z.number().int().nonnegative().optional(),
  returnGamesPlayed: z.number().int().nonnegative().optional(),
  returnGamesWon: z.number().int().nonnegative().optional(),
  totalPointsWon: z.number().int().nonnegative().optional(),
  availableMetrics: z.array(z.string()),
});

export const zMatchSide = z.object({
  playerId: z.string().min(1),
  playerName: z.string().min(1),
  side: z.enum(["home", "away"]),
  seed: z.number().int().positive().optional(),
  rankAtMatch: z.number().int().positive().optional(),
  isWinner: z.boolean().optional(),
});

export const zTennisMatch = z.object({
  id: z.string().min(1),
  tournamentId: z.string().min(1),
  season: z.number().int(),
  surface: zSurface,
  environment: zEnvironment,
  format: zMatchFormat,
  round: zDrawRound,
  state: zMatchState,
  startTime: z.string().optional(),
  home: zMatchSide,
  away: zMatchSide,
  sets: z.array(zSetScore),
  stats: z.array(zMatchStatLine),
  externalIds: z.record(z.string(), z.string()),
  sources: z.array(z.string()),
});

export type ParsedTennisMatch = z.infer<typeof zTennisMatch>;
export type ParsedTennisPlayer = z.infer<typeof zTennisPlayer>;
