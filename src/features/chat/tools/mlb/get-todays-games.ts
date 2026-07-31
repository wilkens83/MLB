/* getTodaysGames — the MLB slate for the resolved date, with probable pitchers
   and live game status. Real data only; empty slate returns a warning. */

import { z } from "zod";
import { getSchedule } from "@/lib/mlb/api";
import { mapGame } from "@/lib/providers/mlbStats";
import { defineTool } from "../types";
import { mlbStatsSource } from "./_shared";

export interface GameRow {
  gamePk: number;
  away: string;
  home: string;
  awayId?: number;
  homeId?: number;
  status: string;
  abstractState: string;
  startTime?: string;
  venue?: string;
  awayProbable?: string;
  homeProbable?: string;
  starterConfirmed: boolean;
}

export interface TodaysGamesOutput {
  date: string;
  count: number;
  games: GameRow[];
}

export const getTodaysGamesTool = defineTool<{ date?: string }, TodaysGamesOutput>({
  name: "getTodaysGames",
  description:
    "List today's (or the resolved date's) MLB games with teams, start time, venue, live status, and probable pitchers. Use for 'what games are on', 'today's slate', 'upcoming games'.",
  domain: "mlb",
  inputSchema: z.object({ date: z.string().optional() }),
  async execute(input, ctx): Promise<import("../types").ToolResult<TodaysGamesOutput>> {
    const date = input.date ?? ctx.date;
    const raw = await getSchedule(date);
    const games: GameRow[] = raw.map((r) => {
      const g = mapGame(r);
      return {
        gamePk: g.gamePk,
        away: g.away.teamName,
        home: g.home.teamName,
        awayId: g.away.teamId,
        homeId: g.home.teamId,
        status: r.status.detailedState,
        abstractState: r.status.abstractGameState,
        startTime: r.gameDate,
        venue: g.venueName,
        awayProbable: g.away.probablePitcherName,
        homeProbable: g.home.probablePitcherName,
        starterConfirmed: false,
      };
    });
    const warnings: string[] = [];
    if (games.length === 0) warnings.push(`No MLB games are scheduled for ${date}.`);
    const tbd = games.filter((g) => !g.awayProbable || !g.homeProbable).length;
    if (tbd > 0)
      warnings.push(
        `${tbd} game(s) have an unconfirmed/undeclared probable pitcher; those starters are labeled projected.`,
      );

    return {
      data: { date, count: games.length, games },
      sources: [mlbStatsSource(`/schedule?date=${date}`)],
      warnings,
      summary: `Loaded ${games.length} games for ${date}`,
      rowCount: games.length,
    };
  },
});
