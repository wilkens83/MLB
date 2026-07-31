/* ============================================================================
   Inbound chat request + guardrail limits. Every field is validated with Zod at
   the API boundary. Limits live here so both the route and the orchestrator
   agree on the same caps.
   ========================================================================== */

import { z } from "zod";

export const CHAT_LIMITS = {
  /** Max user question length (characters). */
  maxMessageLength: 2000,
  /** Max prior turns sent to the model (recent-message window). */
  maxHistoryTurns: 12,
  /** Max tools the orchestrator will run for one request. */
  maxToolsPerRequest: 4,
  /** Per-tool execution timeout (ms). */
  toolTimeoutMs: 15_000,
  /** Overall provider/orchestrator timeout (ms). */
  requestTimeoutMs: 45_000,
  /** Max rows any table block / tool result will emit. */
  maxTableRows: 50,
  /** Rate limit: requests per session per window. */
  rateLimitPerMinute: 20,
} as const;

export const chatSportSchema = z.enum(["mlb", "prizepicks", "tennis", "system"]);
export type ChatSport = z.infer<typeof chatSportSchema>;

/** A trimmed prior turn the client echoes back for multi-turn context. */
export const priorTurnSchema = z.object({
  role: z.enum(["user", "assistant"]),
  content: z.string(),
});

/** Optional imported PrizePicks board rows passed from the client (localStorage). */
export const prizePicksContextEntrySchema = z.object({
  playerName: z.string(),
  marketKey: z.string().optional(),
  rawMarketLabel: z.string().optional(),
  line: z.number(),
  mlbPlayerId: z.number().optional(),
  projectionType: z.string().optional(),
  sourceType: z.string().optional(),
});
export type PrizePicksContextEntry = z.infer<typeof prizePicksContextEntrySchema>;

export const chatRequestSchema = z.object({
  message: z.string().trim().min(1).max(CHAT_LIMITS.maxMessageLength),
  conversationId: z.string().optional(),
  sport: chatSportSchema.default("mlb"),
  /** Explicit date context (YYYY-MM-DD); relative phrases resolve server-side. */
  date: z
    .string()
    .regex(/^\d{4}-\d{2}-\d{2}$/)
    .optional(),
  /** IANA timezone of the user, e.g. "America/New_York". */
  timezone: z.string().optional(),
  /** Optional locked player/game context from a prior turn. */
  context: z
    .object({
      playerId: z.number().optional(),
      gamePk: z.number().optional(),
    })
    .optional(),
  /** Client-echoed recent turns (server also has authoritative history). */
  history: z.array(priorTurnSchema).max(CHAT_LIMITS.maxHistoryTurns).optional(),
  /** Imported PrizePicks board (client localStorage) for the given date. */
  prizePicksBoard: z.array(prizePicksContextEntrySchema).max(200).optional(),
});
export type ChatRequest = z.infer<typeof chatRequestSchema>;
