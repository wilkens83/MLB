/* ============================================================================
   Tool registration — builds the allow-list the orchestrator uses. Add a new
   analytics capability by writing a typed tool and registering it here.
   ========================================================================== */

import { ToolRegistry } from "./registry";
import { getTodaysGamesTool } from "./mlb/get-todays-games";
import { searchPlayersTool } from "./mlb/search-players";
import { getPlayerProjectionTool } from "./mlb/get-player-projection";
import { getPitcherStrikeoutRankingsTool, getHitterHomeRunRankingsTool } from "./mlb/rankings";
import { comparePlayersTool } from "./mlb/compare-players";
import { getDataHealthTool } from "./mlb/get-data-health";
import { getPrizePicksBoardTool } from "./prizepicks/get-board";
import { getPrizePicksEdgesTool } from "./prizepicks/rank-edges";
import { analyzeEntryTool } from "./prizepicks/analyze-entry";
import { getEntryDecisionTool } from "./prizepicks/entry-decision";
import type { ChatToolDefinition } from "./types";

/** All tools, in a stable order. */
export const ALL_TOOLS: ChatToolDefinition[] = [
  getTodaysGamesTool as ChatToolDefinition,
  searchPlayersTool as ChatToolDefinition,
  getPlayerProjectionTool as ChatToolDefinition,
  getPitcherStrikeoutRankingsTool as ChatToolDefinition,
  getHitterHomeRunRankingsTool as ChatToolDefinition,
  comparePlayersTool as ChatToolDefinition,
  getDataHealthTool as ChatToolDefinition,
  getPrizePicksBoardTool as ChatToolDefinition,
  getPrizePicksEdgesTool as ChatToolDefinition,
  analyzeEntryTool as ChatToolDefinition,
  getEntryDecisionTool as ChatToolDefinition,
];

/** Build a fresh registry with every tool registered. */
export function buildToolRegistry(): ToolRegistry {
  const registry = new ToolRegistry();
  for (const tool of ALL_TOOLS) registry.register(tool);
  return registry;
}

export { ToolRegistry } from "./registry";
export type { ChatToolDefinition, ChatToolContext, ToolResult } from "./types";
