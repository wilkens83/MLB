/* getPlayerProjection — full projection + Monte Carlo for one player/prop via
   the EXISTING runAnalysis engine. The market line is only a threshold; the
   model's expectation is computed from real MLB/Statcast data. */

import { z } from "zod";
import { runAnalysis } from "@/lib/mlb/analysis";
import { getProp } from "@/lib/props/catalog";
import { round } from "@/lib/utils";
import { defineTool, type ToolResult } from "../types";
import { mlbStatsSource, savantSource, modelSource } from "./_shared";

export interface PlayerProjectionOutput {
  playerId: number;
  playerName: string | null;
  team: string;
  prop: string;
  propLabel: string;
  line: number;
  projection: number | null;
  overProbability: number | null;
  underProbability: number | null;
  confidence: number | null;
  recommendation: string | null;
  edge: number | null;
  fairAmerican: number | null;
  expectedValue: number | null;
  sampleSize: number;
  season: number;
  lineupConfirmed: boolean;
  starterConfirmed: boolean;
  /** Short, evidence-based factors behind the recommendation (no chain-of-thought). */
  factors: string[];
}

export const getPlayerProjectionTool = defineTool<
  { playerId: number; prop: string; line?: number; overAmerican?: number; underAmerican?: number },
  PlayerProjectionOutput
>({
  name: "getPlayerProjection",
  description:
    "Run the Diamond Edge projection + 10k Monte Carlo for one player and one prop market (e.g. strikeouts, home_runs, total_bases, hits). Returns model probability, edge, fair odds, EV, confidence, and the factors behind the pick. Requires a resolved playerId.",
  domain: "mlb",
  inputSchema: z.object({
    playerId: z.number(),
    prop: z.string(),
    line: z.number().optional(),
    overAmerican: z.number().optional(),
    underAmerican: z.number().optional(),
  }),
  async execute(input, ctx): Promise<ToolResult<PlayerProjectionOutput>> {
    ctx.log("getPlayerProjection", { playerId: input.playerId, prop: input.prop });
    const prop = getProp(input.prop);
    if (!prop) {
      return {
        data: emptyProjection(input.playerId, input.prop, input.line ?? 0, ctx.season),
        sources: [],
        warnings: [`"${input.prop}" is not a supported prop market.`],
        summary: `Unknown prop ${input.prop}`,
      };
    }
    const payload = await runAnalysis({
      playerId: input.playerId,
      propKey: input.prop,
      line: input.line,
      side: "over",
      overAmerican: input.overAmerican,
      underAmerican: input.underAmerican,
      season: ctx.season,
    });
    const a = payload.analysis;
    const warnings = payload.warnings.map((w) => w.message);
    if (payload.error) warnings.push(`Analysis unavailable: ${payload.error}.`);

    const best = a?.recommendation.best ?? null;
    const factors = (payload.breakdown?.factors ?? [])
      .filter((f) => Math.abs(f.multiplier - 1) > 0.01)
      .slice(0, 5)
      .map(
        (f) =>
          `${f.label}: ${f.multiplier >= 1 ? "+" : ""}${round((f.multiplier - 1) * 100, 0)}%`,
      );

    const out: PlayerProjectionOutput = {
      playerId: input.playerId,
      playerName: payload.player?.name ?? null,
      team: payload.player?.team ?? "",
      prop: input.prop,
      propLabel: prop.label,
      line: a?.line ?? input.line ?? prop.defaultLine,
      projection: a ? round(a.projection.lambda, 2) : null,
      overProbability: a ? round(a.simulation.probOver, 3) : null,
      underProbability: a ? round(a.simulation.probUnder, 3) : null,
      confidence: a ? a.recommendation.confidence : null,
      recommendation: a?.recommendation.recommendation ?? null,
      edge: best ? round(best.edge, 3) : null,
      fairAmerican: best ? best.fairAmerican : null,
      expectedValue: best ? round(best.ev, 3) : null,
      sampleSize: payload.meta.sampleSize,
      season: payload.meta.season,
      lineupConfirmed: payload.opponent?.lineupConfirmed ?? false,
      starterConfirmed: payload.opponent?.starterConfirmed ?? false,
      factors,
    };

    const sources = [
      mlbStatsSource(`/people/${input.playerId}/stats?stats=gameLog`),
      savantSource("/leaderboard/custom", a ? payload.statcast.batter?.fetchedAt ?? payload.statcast.pitcher?.fetchedAt : undefined),
      modelSource(payload.lastUpdated),
    ];
    return {
      data: out,
      sources,
      warnings,
      summary: a
        ? `${out.playerName ?? "player"} ${prop.label} ${out.line}: ${out.recommendation}`
        : `No projection for player ${input.playerId} / ${input.prop}`,
    };
  },
});

function emptyProjection(
  playerId: number,
  prop: string,
  line: number,
  season: number,
): PlayerProjectionOutput {
  return {
    playerId,
    playerName: null,
    team: "",
    prop,
    propLabel: prop,
    line,
    projection: null,
    overProbability: null,
    underProbability: null,
    confidence: null,
    recommendation: null,
    edge: null,
    fairAmerican: null,
    expectedValue: null,
    sampleSize: 0,
    season,
    lineupConfirmed: false,
    starterConfirmed: false,
    factors: [],
  };
}
