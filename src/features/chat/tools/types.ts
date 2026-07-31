/* ============================================================================
   Controlled analytics tool layer. The model may ONLY reach project data through
   these typed, server-side tools — never arbitrary modules, SQL, or shell. Each
   tool declares a Zod input schema and returns structured data with its own
   sources + warnings. The registry is the allow-list.
   ========================================================================== */

import type { z } from "zod";
import type { DataSourceReference } from "../schemas/sources";
import type { ChatSport, PrizePicksContextEntry } from "../schemas/request";

/** Context threaded into every tool: resolved date, sport, and locked entities. */
export interface ChatToolContext {
  /** Resolved slate date, YYYY-MM-DD (relative phrases already converted). */
  date: string;
  /** Resolved MLB season for the date. */
  season: number;
  sport: ChatSport;
  timezone: string;
  /** Locked player/game from prior turns, if any. */
  playerId?: number;
  gamePk?: number;
  /** Imported PrizePicks board rows (client-provided), if any. */
  prizePicksBoard?: PrizePicksContextEntry[];
  /** Abort signal for cancellation / timeout. */
  signal?: AbortSignal;
  /** Structured logger scoped to the request. */
  log: (event: string, fields?: Record<string, unknown>) => void;
}

/** Every tool result carries provenance + warnings; `data` is tool-specific. */
export interface ToolResult<T> {
  data: T;
  sources: DataSourceReference[];
  warnings: string[];
  /** Human label for the "tool status" line, e.g. "Ranked 8 pitchers". */
  summary: string;
  rowCount?: number;
}

export interface ChatToolDefinition<TInput = unknown, TOutput = unknown> {
  name: string;
  /** One-line description used by the model/intent layer to pick the tool. */
  description: string;
  /** Which sport domain this tool serves (for filtering by selected sport). */
  domain: ChatSport;
  inputSchema: z.ZodType<TInput>;
  execute: (input: TInput, context: ChatToolContext) => Promise<ToolResult<TOutput>>;
}

/** Helper to define a tool with inferred input/output types. */
export function defineTool<TInput, TOutput>(
  def: ChatToolDefinition<TInput, TOutput>,
): ChatToolDefinition<TInput, TOutput> {
  return def;
}
