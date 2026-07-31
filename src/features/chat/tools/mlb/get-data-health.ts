/* getDataHealth — provider liveness + slate coverage for the resolved date.
   Answers "what data is missing today?" from real provider health + schedule. */

import { z } from "zod";
import { getAllHealth } from "@/lib/providers/health";
import { getSchedule } from "@/lib/mlb/api";
import { mapGame } from "@/lib/providers/mlbStats";
import { MODEL_VERSION } from "@/lib/mlb/analysis";
import { defineTool, type ToolResult } from "../types";
import { makeSource } from "../../schemas/sources";

export interface ProviderStatus {
  name: string;
  requests: number;
  failures: number;
  avgResponseMs: number;
  lastSuccessAt: string | null;
  healthy: boolean;
}
export interface DataHealthOutput {
  date: string;
  season: number;
  modelVersion: string;
  providers: ProviderStatus[];
  slate: {
    games: number;
    gamesWithBothProbables: number;
    gamesMissingProbable: number;
  };
  missing: string[];
}

export const getDataHealthTool = defineTool<Record<string, never>, DataHealthOutput>({
  name: "getDataHealth",
  description:
    "Report data-source health (MLB Stats API, Baseball Savant, projection engine) and today's slate coverage: how many games have confirmed probable pitchers, and what data is missing. Use for 'what data is missing today', 'system health', 'is Savant up'.",
  domain: "system",
  inputSchema: z.object({}),
  async execute(_input, ctx): Promise<ToolResult<DataHealthOutput>> {
    const health = getAllHealth();
    const providers: ProviderStatus[] = health.map((h) => ({
      name: h.name,
      requests: h.requests,
      failures: h.failures,
      avgResponseMs: Math.round(h.avgResponseMs),
      lastSuccessAt: h.lastSuccessAt ? new Date(h.lastSuccessAt).toISOString() : null,
      healthy: h.requests === 0 ? true : h.failures / h.requests < 0.5,
    }));

    const raw = await getSchedule(ctx.date).catch(() => []);
    const games = raw.map(mapGame);
    const withBoth = games.filter((g) => g.away.probablePitcherId && g.home.probablePitcherId).length;
    const missingProbable = games.length - withBoth;

    const missing: string[] = [];
    if (games.length === 0) missing.push(`No games scheduled for ${ctx.date}.`);
    if (missingProbable > 0) missing.push(`${missingProbable} game(s) missing a confirmed probable pitcher.`);
    for (const p of providers) if (!p.healthy) missing.push(`Provider "${p.name}" is degraded (${p.failures}/${p.requests} failed).`);
    if (missing.length === 0) missing.push("No critical data gaps detected for the resolved date.");

    return {
      data: {
        date: ctx.date,
        season: ctx.season,
        modelVersion: MODEL_VERSION,
        providers,
        slate: { games: games.length, gamesWithBothProbables: withBoth, gamesMissingProbable: missingProbable },
        missing,
      },
      sources: [makeSource({ name: "Diamond Edge data-health registry", type: "database", dataAsOf: Date.now() })],
      warnings: [],
      summary: `Health: ${providers.length} providers, ${withBoth}/${games.length} games fully covered`,
    };
  },
});
