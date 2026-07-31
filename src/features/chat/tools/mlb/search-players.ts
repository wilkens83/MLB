/* searchPlayers — resolve a name to real MLB players (by ID, never by name
   alone). Returns candidates so the caller can disambiguate. */

import { z } from "zod";
import { searchPlayers } from "@/lib/mlb/api";
import { defineTool, type ToolResult } from "../types";
import { mlbStatsSource } from "./_shared";

export interface PlayerHit {
  playerId: number;
  name: string;
  position?: string;
  team?: string;
  bats?: string;
  throws?: string;
}
export interface SearchPlayersOutput {
  query: string;
  count: number;
  players: PlayerHit[];
  ambiguous: boolean;
}

export const searchPlayersTool = defineTool<{ query: string }, SearchPlayersOutput>({
  name: "searchPlayers",
  description:
    "Find MLB players by name. Returns candidate players with IDs, team, position, and handedness. Use to resolve a player before fetching stats/projections, and to detect ambiguous names.",
  domain: "mlb",
  inputSchema: z.object({ query: z.string().min(2) }),
  async execute(input, ctx): Promise<ToolResult<SearchPlayersOutput>> {
    ctx.log("searchPlayers", { query: input.query });
    const hits = await searchPlayers(input.query);
    const players: PlayerHit[] = hits.map((p) => ({
      playerId: p.id,
      name: p.fullName,
      position: p.primaryPosition?.abbreviation,
      team: p.currentTeam?.name,
      bats: p.batSide?.code,
      throws: p.pitchHand?.code,
    }));
    const warnings: string[] = [];
    if (players.length === 0) warnings.push(`No active MLB player matched "${input.query}".`);
    if (players.length > 1)
      warnings.push(
        `"${input.query}" matched ${players.length} players — resolve by ID before using stats.`,
      );
    return {
      data: { query: input.query, count: players.length, players, ambiguous: players.length > 1 },
      sources: [mlbStatsSource(`/people/search?names=${encodeURIComponent(input.query)}`)],
      warnings,
      summary: `Found ${players.length} player(s) for "${input.query}"`,
      rowCount: players.length,
    };
  },
});
