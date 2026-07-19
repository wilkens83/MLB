/* ============================================================================
   Zod schemas for the MLB Stats API responses we consume. External data is
   validated at the boundary; malformed/partial payloads degrade gracefully
   instead of crashing (see safeValidate).
   ========================================================================== */

import { z } from "zod";

/** Loosely validate then narrow — the MLB API returns many extra fields. */
export const teamSchema = z.object({
  id: z.number(),
  name: z.string(),
  abbreviation: z.string().optional(),
  teamName: z.string().optional(),
  venue: z.object({ id: z.number().optional(), name: z.string().optional() }).optional(),
});

export const probablePitcherSchema = z.object({
  id: z.number(),
  fullName: z.string(),
});

export const gameSideSchema = z.object({
  team: teamSchema,
  score: z.number().optional(),
  isWinner: z.boolean().optional(),
  probablePitcher: probablePitcherSchema.optional(),
  leagueRecord: z
    .object({ wins: z.number(), losses: z.number(), pct: z.string().optional() })
    .optional(),
});

export const linescoreSchema = z
  .object({
    currentInning: z.number().optional(),
    inningState: z.string().optional(),
    isTopInning: z.boolean().optional(),
  })
  .optional();

export const gameSchema = z.object({
  gamePk: z.number(),
  gameDate: z.string(),
  officialDate: z.string().optional(),
  gameType: z.string().optional(),
  status: z.object({
    abstractGameState: z.string(),
    detailedState: z.string(),
    statusCode: z.string().optional(),
  }),
  teams: z.object({ away: gameSideSchema, home: gameSideSchema }),
  venue: z.object({ id: z.number().optional(), name: z.string().optional() }).optional(),
  linescore: linescoreSchema,
  dayNight: z.enum(["day", "night"]).optional(),
  seriesDescription: z.string().optional(),
});

export const scheduleSchema = z.object({
  totalGames: z.number().optional(),
  dates: z.array(z.object({ date: z.string(), games: z.array(gameSchema) })).default([]),
});

export const personSchema = z.object({
  id: z.number(),
  fullName: z.string(),
  primaryNumber: z.string().optional(),
  currentTeam: z.object({ id: z.number(), name: z.string() }).optional(),
  primaryPosition: z
    .object({ code: z.string(), name: z.string(), abbreviation: z.string() })
    .optional(),
  batSide: z.object({ code: z.string(), description: z.string().optional() }).optional(),
  pitchHand: z.object({ code: z.string(), description: z.string().optional() }).optional(),
});

export const peopleSchema = z.object({ people: z.array(personSchema).default([]) });

export const gameLogSplitSchema = z.object({
  season: z.string().optional(),
  date: z.string().optional(),
  isHome: z.boolean().optional(),
  isWin: z.boolean().optional(),
  opponent: z.object({ id: z.number().optional(), name: z.string().optional() }).optional(),
  team: z.object({ id: z.number().optional(), name: z.string().optional() }).optional(),
  game: z.object({ gamePk: z.number().optional() }).optional(),
  // The stat object is a bag of numeric-ish fields; validate leniently.
  stat: z.record(z.string(), z.union([z.number(), z.string()])).default({}),
});

export const statsSchema = z.object({
  stats: z
    .array(
      z.object({
        splits: z.array(gameLogSplitSchema).default([]),
      }),
    )
    .default([]),
});

export type ScheduleParsed = z.infer<typeof scheduleSchema>;
export type PeopleParsed = z.infer<typeof peopleSchema>;
export type StatsParsed = z.infer<typeof statsSchema>;
export type GameParsed = z.infer<typeof gameSchema>;
export type PersonParsed = z.infer<typeof personSchema>;
