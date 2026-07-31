/* Ranking tools — pitcher strikeout projections and hitter home-run probability
   across the slate. Both reuse the tested market engine via collectMarketCards.
   Structured rows only; empty/partial slates return warnings. */

import { z } from "zod";
import { defineTool, type ToolResult, type ChatToolContext } from "../types";
import { collectMarketCards, mlbStatsSource, savantSource, modelSource } from "./_shared";
import type { MarketCard } from "@/lib/mlb/market";

export interface RankingRow {
  playerId: number;
  playerName: string;
  team: string;
  opponent: string;
  projection: number | null;
  marketLine: number | null;
  overProbability: number | null;
  confidence: number | null;
  gamePk: number | null;
  lineupStatus: string;
}

export interface RankingOutput {
  date: string;
  season: number;
  market: string;
  marketLabel: string;
  rows: RankingRow[];
  gamesProcessed: number;
  gamesTotal: number;
}

function toRow(c: MarketCard): RankingRow {
  return {
    playerId: c.playerId,
    playerName: c.name,
    team: c.teamName,
    opponent: c.opponentName,
    projection: c.projection,
    marketLine: c.line,
    overProbability: c.overProb,
    confidence: Math.round(c.dataQuality),
    gamePk: c.gamePk,
    lineupStatus: c.lineupStatus,
  };
}

async function rank(
  ctx: ChatToolContext,
  market: string,
  marketLabel: string,
  limit: number,
  maxGames: number,
  sortBy: "projection" | "overProb",
): Promise<ToolResult<RankingOutput>> {
  const { cards, warnings, gamesProcessed, gamesTotal } = await collectMarketCards(ctx, market, maxGames);
  cards.sort((a, b) =>
    sortBy === "projection" ? b.projection - a.projection : b.overProb - a.overProb,
  );
  const rows = cards.slice(0, limit).map(toRow);
  if (rows.some((r) => r.lineupStatus === "projected"))
    warnings.push("Hitter lineups are projected from each team's most recent game, not confirmed.");
  return {
    data: { date: ctx.date, season: ctx.season, market, marketLabel, rows, gamesProcessed, gamesTotal },
    sources: [
      mlbStatsSource(`/schedule?date=${ctx.date}`),
      savantSource("/leaderboard/custom"),
      modelSource(),
    ],
    warnings,
    summary: `Ranked ${rows.length} ${marketLabel.toLowerCase()} candidates across ${gamesProcessed} games`,
    rowCount: rows.length,
  };
}

export const getPitcherStrikeoutRankingsTool = defineTool<{ limit?: number }, RankingOutput>({
  name: "getPitcherStrikeoutRankings",
  description:
    "Rank today's probable pitchers by projected strikeouts (best strikeout projections). Use for 'which pitchers have the best strikeout projections today'.",
  domain: "mlb",
  inputSchema: z.object({ limit: z.number().min(1).max(50).optional() }),
  execute: (input, ctx) =>
    rank(ctx, "strikeouts", "Pitcher Strikeouts", input.limit ?? 10, 15, "projection"),
});

export const getHitterHomeRunRankingsTool = defineTool<{ limit?: number }, RankingOutput>({
  name: "getHitterHomeRunRankings",
  description:
    "Rank today's hitters by home-run probability / projection. Use for 'strongest home run projections', 'hitters with the highest HR probability'.",
  domain: "mlb",
  inputSchema: z.object({ limit: z.number().min(1).max(50).optional() }),
  execute: (input, ctx) =>
    rank(ctx, "home_runs", "Home Runs", input.limit ?? 10, 8, "overProb"),
});
