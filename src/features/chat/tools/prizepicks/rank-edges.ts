/* getPrizePicksEdges — evaluate each imported board entry through the EXISTING
   engine (evaluateEntry → runAnalysis) and rank by model edge. The imported line
   is only the threshold. Requires entries resolved to an MLB player ID + market. */

import { z } from "zod";
import { evaluateEntry } from "@/lib/prizepicks/evaluate";
import { resolveMarket } from "@/lib/prizepicks/market-map";
import { round } from "@/lib/utils";
import { defineTool, type ToolResult } from "../types";
import { makeSource } from "../../schemas/sources";
import { mlbStatsSource, modelSource } from "../mlb/_shared";

export interface EdgeRow {
  playerName: string;
  market: string;
  line: number;
  projection: number | null;
  projectionDiff: number | null;
  recommendation: "More" | "Less" | "—";
  probability: number | null;
  edge: number | null;
  confidence: number | null;
  sampleSize: number;
  stale: boolean;
}
export interface PrizePicksEdgesOutput {
  date: string;
  count: number;
  evaluated: number;
  rows: EdgeRow[];
  unresolved: string[];
}

export const getPrizePicksEdgesTool = defineTool<{ limit?: number }, PrizePicksEdgesOutput>({
  name: "getPrizePicksEdges",
  description:
    "Evaluate the imported PrizePicks board against the Diamond Edge model and rank entries by edge (projection vs line). Returns More/Less lean, model probability, and confidence. Use for 'which PrizePicks lines have the highest edge', 'best PrizePicks value', 'stale lines'.",
  domain: "prizepicks",
  inputSchema: z.object({ limit: z.number().min(1).max(50).optional() }),
  async execute(input, ctx): Promise<ToolResult<PrizePicksEdgesOutput>> {
    const board = ctx.prizePicksBoard ?? [];
    if (board.length === 0) {
      return {
        data: { date: ctx.date, count: 0, evaluated: 0, rows: [], unresolved: [] },
        sources: [],
        warnings: [`No PrizePicks board has been imported for ${ctx.date}.`],
        summary: "No imported PrizePicks board",
      };
    }

    const unresolved: string[] = [];
    const evaluations = await Promise.all(
      board.map(async (e, i) => {
        const marketKey = e.marketKey ?? resolveMarket(e.rawMarketLabel ?? "").market?.canonical;
        if (!e.mlbPlayerId || !marketKey) {
          unresolved.push(e.playerName);
          return null;
        }
        const evalResult = await evaluateEntry({
          entryId: `chat-${i}`,
          mlbPlayerId: e.mlbPlayerId,
          marketKey,
          line: e.line,
          pregame: true,
        }).catch(() => null);
        if (!evalResult) return null;
        const more = evalResult.probMore >= evalResult.probLess;
        const prob = more ? evalResult.probMore : evalResult.probLess;
        const row: EdgeRow = {
          playerName: e.playerName,
          market: e.rawMarketLabel ?? marketKey,
          line: e.line,
          projection: round(evalResult.projection, 2),
          projectionDiff: round(evalResult.projectionDiff, 2),
          recommendation: more ? "More" : "Less",
          probability: round(prob, 3),
          edge: round(Math.abs(prob - 0.5), 3),
          confidence: Math.round(evalResult.dataQuality),
          sampleSize: evalResult.sampleSize,
          stale: evalResult.sampleSize < 5,
        };
        return row;
      }),
    );

    const rows = evaluations.filter((r): r is EdgeRow => r !== null);
    rows.sort((a, b) => (b.edge ?? 0) - (a.edge ?? 0));
    const limited = rows.slice(0, input.limit ?? 15);

    const warnings: string[] = [];
    if (unresolved.length)
      warnings.push(`${unresolved.length} entr(y/ies) could not be resolved to a player+market and were skipped.`);
    if (limited.some((r) => r.stale))
      warnings.push("Some entries have a thin sample (<5 games) — treat their edge cautiously.");

    return {
      data: { date: ctx.date, count: board.length, evaluated: rows.length, rows: limited, unresolved },
      sources: [
        makeSource({ name: "PrizePicks CSV/paste import", type: "prizepicks-import", dataAsOf: Date.now() }),
        mlbStatsSource("/people/{id}/stats?stats=gameLog"),
        modelSource(),
      ],
      warnings,
      summary: `Ranked ${limited.length}/${board.length} PrizePicks entries by edge`,
      rowCount: limited.length,
    };
  },
});
