/* comparePlayers — side-by-side recent-form comparison for two players over a
   window (default last 15 games) for a chosen prop. Reuses game logs + series. */

import { z } from "zod";
import { getPlayer, getGameLog } from "@/lib/mlb/api";
import { mapPlayer } from "@/lib/providers/mlbStats";
import { extractPropSeries, seriesValues, statGroupForProp } from "@/lib/mlb/series";
import { getProp } from "@/lib/props/catalog";
import { mean } from "@/lib/math/stats";
import { round } from "@/lib/utils";
import { defineTool, type ToolResult } from "../types";
import { mlbStatsSource, modelSource } from "./_shared";

export interface ComparePlayerSide {
  playerId: number;
  name: string | null;
  team: string;
  window: number;
  average: number | null;
  recentValues: number[];
  hitRateOverDefault: number | null;
  sampleSize: number;
}
export interface ComparePlayersOutput {
  prop: string;
  propLabel: string;
  line: number;
  window: number;
  a: ComparePlayerSide;
  b: ComparePlayerSide;
  edge: string | null;
}

async function side(
  playerId: number,
  prop: string,
  season: number,
  window: number,
  line: number,
): Promise<ComparePlayerSide> {
  const raw = await getPlayer(playerId).catch(() => null);
  const player = raw ? mapPlayer(raw) : null;
  const group = statGroupForProp(prop);
  const log = await getGameLog(playerId, group, season).catch(() => []);
  const all = seriesValues(extractPropSeries(prop, log));
  const recent = all.slice(Math.max(0, all.length - window));
  const overs = recent.filter((v) => v > line).length;
  return {
    playerId,
    name: player?.name ?? null,
    team: player?.teamName ?? "",
    window,
    average: recent.length ? round(mean(recent), 2) : null,
    recentValues: recent,
    hitRateOverDefault: recent.length ? round(overs / recent.length, 3) : null,
    sampleSize: recent.length,
  };
}

export const comparePlayersTool = defineTool<
  { playerIdA: number; playerIdB: number; prop?: string; window?: number },
  ComparePlayersOutput
>({
  name: "comparePlayers",
  description:
    "Compare two MLB players over their recent games (default last 15) for a prop (default total_bases): averages, recent values, and over-rate. Requires two resolved playerIds. Use for 'compare X and Y'.",
  domain: "mlb",
  inputSchema: z.object({
    playerIdA: z.number(),
    playerIdB: z.number(),
    prop: z.string().optional(),
    window: z.number().min(1).max(50).optional(),
  }),
  async execute(input, ctx): Promise<ToolResult<ComparePlayersOutput>> {
    const propKey = input.prop ?? "total_bases";
    const prop = getProp(propKey);
    const line = prop?.defaultLine ?? 1.5;
    const window = input.window ?? 15;
    const [a, b] = await Promise.all([
      side(input.playerIdA, propKey, ctx.season, window, line),
      side(input.playerIdB, propKey, ctx.season, window, line),
    ]);
    const warnings: string[] = [];
    if (a.sampleSize === 0) warnings.push(`No ${ctx.season} ${propKey} data for player ${input.playerIdA}.`);
    if (b.sampleSize === 0) warnings.push(`No ${ctx.season} ${propKey} data for player ${input.playerIdB}.`);
    if (a.sampleSize !== b.sampleSize && a.sampleSize && b.sampleSize)
      warnings.push(
        `Sample windows differ (${a.name}: ${a.sampleSize} games, ${b.name}: ${b.sampleSize}); comparison is not exactly like-for-like.`,
      );

    let edge: string | null = null;
    if (a.average !== null && b.average !== null) {
      if (a.average === b.average) edge = "Even";
      else edge = (a.average > b.average ? a.name : b.name) ?? null;
    }

    return {
      data: { prop: propKey, propLabel: prop?.label ?? propKey, line, window, a, b, edge },
      sources: [mlbStatsSource("/people/{id}/stats?stats=gameLog"), modelSource()],
      warnings,
      summary: `Compared ${a.name ?? "A"} vs ${b.name ?? "B"} over last ${window} (${prop?.label ?? propKey})`,
    };
  },
});
