/* analyzeEntry (chat tool) — correlation-aware analysis of a COMPLETE PrizePicks
   entry built from the user's imported board. Resolves each leg to a real
   game-log-derived simulation model, then runs the joint entry engine
   (correlation, contradiction, outcome distribution, Power/Flex payout).
   Imported board only — never live; direction defaults to "More" (the board
   does not store the user's pick side) and that is stated in a warning. */

import { z } from "zod";
import { getPlayer, getGameLog } from "@/lib/mlb/api";
import { mapPlayer } from "@/lib/providers/mlbStats";
import {
  estimatePaRates, expectedPasPerGame, estimatePitcherAllowedRates, expectedBattersFaced,
} from "@/lib/prediction/paSim";
import { resolveMarket } from "@/lib/prizepicks/market-map";
import { analyzeEntry, type EntryLegInput } from "@/lib/prizepicks/entry/entry";
import type { GameLogEntry } from "@/lib/domain/models";
import { defineTool, type ToolResult } from "../types";
import { makeSource } from "../../schemas/sources";
import { mlbStatsSource, modelSource } from "../mlb/_shared";

export interface AnalyzeEntryOutput {
  entryType: "power" | "flex";
  size: number;
  legs: { label: string; market: string; direction: string; line: number; probWin: number; supported: boolean }[];
  distribution: number[];
  probAllWin: number;
  expectedPayout: number;
  payoutTable: string;
  correlations: { a: string; b: string; correlation: number; sameUnit: boolean; contradiction: boolean; note: string }[];
  contradictions: number;
  warnings: string[];
}

function toGameLogEntries(raw: { stat: unknown; date?: string; opponent?: { name?: string }; isHome?: boolean; gamePk?: number }[]): GameLogEntry[] {
  return raw.map((sp) => {
    const out: Record<string, number> = {};
    for (const [k, v] of Object.entries(sp.stat as Record<string, unknown>)) {
      const n = typeof v === "number" ? v : Number(v);
      if (Number.isFinite(n)) out[k] = n;
    }
    return { stat: out, date: sp.date, isHome: sp.isHome, gamePk: sp.gamePk };
  });
}

export const analyzeEntryTool = defineTool<{ entryType?: "power" | "flex" }, AnalyzeEntryOutput>({
  name: "analyzeEntry",
  description:
    "Analyze a COMPLETE PrizePicks entry (Power or Flex) from the imported board: joint-simulation correlation between legs, contradiction detection, the P(k correct) outcome distribution, and expected Power/Flex payout. Use for 'analyze my entry', 'is my entry correlated', 'entry EV', 'flex vs power'.",
  domain: "prizepicks",
  inputSchema: z.object({ entryType: z.enum(["power", "flex"]).optional() }),
  async execute(input, ctx): Promise<ToolResult<AnalyzeEntryOutput>> {
    const board = (ctx.prizePicksBoard ?? []).slice(0, 6);
    const entryType = input.entryType ?? "flex";
    if (board.length < 2) {
      return {
        data: { entryType, size: board.length, legs: [], distribution: [], probAllWin: 0, expectedPayout: 0, payoutTable: "n/a", correlations: [], contradictions: 0, warnings: [] },
        sources: [],
        warnings: [`Entry analysis needs at least 2 imported legs; the board for ${ctx.date} has ${board.length}.`],
        summary: "Not enough legs for an entry",
      };
    }

    const warnings: string[] = ["Leg direction defaults to \"More\" (the imported board doesn't store your pick side)."];
    const legs: EntryLegInput[] = [];
    for (let i = 0; i < board.length; i++) {
      const e = board[i];
      const market = e.marketKey ?? resolveMarket(e.rawMarketLabel ?? "").market?.canonical;
      if (!e.mlbPlayerId || !market) {
        warnings.push(`Skipped "${e.playerName}" — unresolved player or market.`);
        continue;
      }
      const rawPlayer = await getPlayer(e.mlbPlayerId).catch(() => null);
      const player = rawPlayer ? mapPlayer(rawPlayer) : null;
      if (!player) {
        warnings.push(`Skipped "${e.playerName}" — player ${e.mlbPlayerId} not found.`);
        continue;
      }
      const isPitcher = player.isPitcher;
      const rawLog = await getGameLog(e.mlbPlayerId, isPitcher ? "pitching" : "hitting", ctx.season).catch(() => []);
      const log = toGameLogEntries(rawLog as never);
      if (log.length === 0) {
        warnings.push(`Skipped "${e.playerName}" — no ${ctx.season} game log.`);
        continue;
      }
      const model = isPitcher
        ? { kind: "pitcher" as const, allowedRates: estimatePitcherAllowedRates(log), expectedBF: expectedBattersFaced(log) }
        : { kind: "hitter" as const, rates: estimatePaRates(log), expectedPa: expectedPasPerGame(log) };
      legs.push({
        id: `leg-${i}`,
        label: `${player.name} ${market} ${e.line}`,
        playerId: e.mlbPlayerId,
        gamePk: undefined,
        market,
        direction: "more",
        line: e.line,
        model,
      });
    }

    if (legs.length < 2) {
      return {
        data: { entryType, size: legs.length, legs: [], distribution: [], probAllWin: 0, expectedPayout: 0, payoutTable: "n/a", correlations: [], contradictions: 0, warnings },
        sources: [makeSource({ name: "PrizePicks CSV/paste import", type: "prizepicks-import", dataAsOf: Date.now() })],
        warnings: [...warnings, "Fewer than 2 legs could be resolved to a simulation model."],
        summary: "Entry could not be resolved",
      };
    }

    const analysis = analyzeEntry({ legs, entryType, iterations: 8000, seed: `entry:${ctx.date}` });

    return {
      data: {
        entryType: analysis.entryType,
        size: analysis.size,
        legs: analysis.legs.map((l) => ({ label: l.label, market: l.market, direction: l.direction, line: l.line, probWin: Math.round(l.probWin * 1000) / 1000, supported: l.supported })),
        distribution: analysis.distribution.map((p) => Math.round(p * 1000) / 1000),
        probAllWin: Math.round(analysis.probAllWin * 1000) / 1000,
        expectedPayout: analysis.payout.ev,
        payoutTable: analysis.payout.table,
        correlations: analysis.correlations.map((c) => ({ a: c.aLabel, b: c.bLabel, correlation: c.correlation, sameUnit: c.sameUnit, contradiction: c.contradiction, note: c.note })),
        contradictions: analysis.contradictions.length,
        warnings: analysis.warnings,
      },
      sources: [
        makeSource({ name: "PrizePicks CSV/paste import", type: "prizepicks-import", dataAsOf: Date.now() }),
        mlbStatsSource("/people/{id}/stats?stats=gameLog"),
        modelSource(),
      ],
      warnings: [...warnings, ...analysis.warnings],
      summary: `Analyzed a ${analysis.size}-leg ${entryType} entry (${analysis.contradictions.length} contradiction(s))`,
      rowCount: analysis.size,
    };
  },
});
