/* getPrizePicksBoard — surface the imported PrizePicks board rows for the date.
   PrizePicks data is NEVER live here: it is manually imported (paste/CSV) on the
   client and passed through the request context. Always exposes the import source. */

import { z } from "zod";
import { resolveMarket } from "@/lib/prizepicks/market-map";
import { defineTool, type ToolResult } from "../types";
import { makeSource } from "../../schemas/sources";

export interface BoardRow {
  playerName: string;
  market: string;
  line: number;
  mlbPlayerId: number | null;
  resolvedMarketKey: string | null;
  projectionType: string;
}
export interface PrizePicksBoardOutput {
  date: string;
  imported: boolean;
  count: number;
  rows: BoardRow[];
  unresolvedPlayers: string[];
  unresolvedMarkets: string[];
}

export const getPrizePicksBoardTool = defineTool<Record<string, never>, PrizePicksBoardOutput>({
  name: "getPrizePicksBoard",
  description:
    "List the PrizePicks board entries the user imported for this date (player, market, line). PrizePicks data is manually imported, not live. Use for 'show my PrizePicks board', 'what lines were imported', 'unresolved players'.",
  domain: "prizepicks",
  inputSchema: z.object({}),
  async execute(_input, ctx): Promise<ToolResult<PrizePicksBoardOutput>> {
    const board = ctx.prizePicksBoard ?? [];
    if (board.length === 0) {
      return {
        data: { date: ctx.date, imported: false, count: 0, rows: [], unresolvedPlayers: [], unresolvedMarkets: [] },
        sources: [],
        warnings: [`No PrizePicks board has been imported for ${ctx.date}. Import a board on the PrizePicks Board page first.`],
        summary: "No imported PrizePicks board",
      };
    }
    const unresolvedPlayers: string[] = [];
    const unresolvedMarkets: string[] = [];
    const rows: BoardRow[] = board.map((e) => {
      const resolved = e.marketKey ?? resolveMarket(e.rawMarketLabel ?? "").market?.canonical ?? null;
      if (!e.mlbPlayerId) unresolvedPlayers.push(e.playerName);
      if (!resolved) unresolvedMarkets.push(e.rawMarketLabel ?? e.playerName);
      return {
        playerName: e.playerName,
        market: e.rawMarketLabel ?? resolved ?? "—",
        line: e.line,
        mlbPlayerId: e.mlbPlayerId ?? null,
        resolvedMarketKey: resolved,
        projectionType: e.projectionType ?? "standard",
      };
    });
    const warnings: string[] = [];
    if (unresolvedPlayers.length)
      warnings.push(`${unresolvedPlayers.length} entr(y/ies) could not be resolved to an MLB player ID.`);
    if (unresolvedMarkets.length)
      warnings.push(`${unresolvedMarkets.length} market label(s) are not mapped to a supported prop.`);

    return {
      data: { date: ctx.date, imported: true, count: rows.length, rows, unresolvedPlayers, unresolvedMarkets },
      sources: [makeSource({ name: "PrizePicks CSV/paste import", type: "prizepicks-import", dataAsOf: Date.now() })],
      warnings,
      summary: `Imported PrizePicks board: ${rows.length} entries`,
      rowCount: rows.length,
    };
  },
});
