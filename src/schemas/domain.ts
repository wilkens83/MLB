/* ============================================================================
   Domain contracts (Zod). Runtime-validated shapes for data crossing an adapter
   or workflow boundary. Additive — these mirror/validate the existing
   the existing lib types rather than replacing them. Pure: no imports outside zod, so this
   module runs under Bun and in the browser.
   ========================================================================== */

import { z } from "zod";

export const distFamilySchema = z.enum(["poisson", "negbinom", "bernoulli", "normal"]);
export type DistFamily = z.infer<typeof distFamilySchema>;

export const teamSchema = z.object({
  id: z.number().int().nonnegative().optional(),
  abbr: z.string().optional(),
  name: z.string(),
});
export type Team = z.infer<typeof teamSchema>;

export const gameStatusSchema = z.enum([
  "scheduled", "pre-game", "live", "final", "postponed", "suspended", "unknown",
]);

export const gameSchema = z.object({
  gamePk: z.number().int().positive(),
  date: z.string(), // YYYY-MM-DD
  homeTeam: teamSchema,
  awayTeam: teamSchema,
  status: gameStatusSchema.default("unknown"),
  startTime: z.string().optional(), // ISO
  gameNumber: z.number().int().positive().optional(), // doubleheader
});
export type Game = z.infer<typeof gameSchema>;

export const playerSchema = z.object({
  id: z.number().int().positive(), // MLBAM id — never resolve by name alone
  name: z.string(),
  position: z.string().optional(),
  isPitcher: z.boolean(),
  bats: z.string().optional(),
  throws: z.string().optional(),
  teamId: z.number().int().optional(),
});
export type Player = z.infer<typeof playerSchema>;

export const pitcherRoleSchema = z.enum(["starter", "opener", "bulk", "reliever", "unknown"]);
export const pitcherSchema = playerSchema.extend({
  isPitcher: z.literal(true),
  hand: z.string().optional(),
  role: pitcherRoleSchema.default("unknown"),
});
export type Pitcher = z.infer<typeof pitcherSchema>;

export const lineupSlotSchema = z.object({
  order: z.number().int().min(1).max(9),
  playerId: z.number().int().positive(),
  position: z.string().optional(),
});
export const lineupSchema = z.object({
  gamePk: z.number().int().positive(),
  teamId: z.number().int().optional(),
  confirmed: z.boolean(),
  slots: z.array(lineupSlotSchema),
});
export type Lineup = z.infer<typeof lineupSchema>;

export const weatherContextSchema = z.object({
  tempF: z.number().finite().optional(),
  windMph: z.number().finite().optional(),
  condition: z.string().optional(),
  /** False when material weather data is missing — callers must degrade, not fake. */
  available: z.boolean(),
});
export type WeatherContext = z.infer<typeof weatherContextSchema>;

export const parkContextSchema = z.object({
  venue: z.string().optional(),
  /** Multiplicative factor; must stay within safe bounds (verified downstream). */
  factor: z.number().finite().positive(),
});
export type ParkContext = z.infer<typeof parkContextSchema>;

export const marketCategorySchema = z.enum(["hitter", "pitcher"]);
export const propDefinitionSchema = z.object({
  key: z.string(),
  family: distFamilySchema,
  category: marketCategorySchema,
  label: z.string().optional(),
  supported: z.boolean().default(true),
});
export type PropDefinition = z.infer<typeof propDefinitionSchema>;

export const marketSchema = propDefinitionSchema;
export type Market = z.infer<typeof marketSchema>;

/** User-supplied market price. American odds are the boundary unit. NEVER invented:
    an absent price yields a model-only recommendation with no EV. */
export const marketPriceSchema = z.object({
  line: z.number().finite(),
  overAmerican: z.number().int().optional(),
  underAmerican: z.number().int().optional(),
});
export type MarketPrice = z.infer<typeof marketPriceSchema>;
