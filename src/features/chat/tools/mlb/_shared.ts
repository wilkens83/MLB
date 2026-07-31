/* ============================================================================
   Shared helpers for MLB chat tools: canonical source references and a slate
   market-card collector that reuses the existing (tested) market engine.
   ========================================================================== */

import { buildSlate } from "@/lib/mlb/slate";
import { computeMarketGameCards, type MarketCard } from "@/lib/mlb/market";
import { MODEL_VERSION } from "@/lib/mlb/analysis";
import { makeSource, type DataSourceReference } from "../../schemas/sources";
import type { ChatToolContext } from "../types";

/** MLB Stats API source, "as of" = retrieval (live schedule/log). */
export function mlbStatsSource(endpoint: string, asOf = Date.now()): DataSourceReference {
  return makeSource({ name: "MLB Stats API", type: "mlb-stats-api", endpoint, dataAsOf: asOf });
}

/** Baseball Savant source; asOf defaults to a conservative "hours old" bucket. */
export function savantSource(endpoint: string, asOf?: number): DataSourceReference {
  return makeSource({ name: "Baseball Savant", type: "baseball-savant", endpoint, dataAsOf: asOf });
}

/** Diamond Edge model source, carrying the engine version. */
export function modelSource(asOf = Date.now()): DataSourceReference {
  return makeSource({
    name: "Diamond Edge projection engine",
    type: "diamond-edge-model",
    dataAsOf: asOf,
    modelVersion: MODEL_VERSION,
  });
}

/**
 * Collect market cards across the slate for one market, reusing
 * `computeMarketGameCards`. Bounded by `maxGames` for latency; a warning is
 * returned when the slate is larger than the processed sample.
 */
export async function collectMarketCards(
  ctx: ChatToolContext,
  marketKey: string,
  maxGames: number,
): Promise<{ cards: MarketCard[]; warnings: string[]; gamesProcessed: number; gamesTotal: number }> {
  const slate = await buildSlate(ctx.date);
  const games = slate.games;
  const warnings: string[] = [];
  const process = games.slice(0, maxGames);
  if (games.length > process.length) {
    warnings.push(
      `Slate has ${games.length} games; ranked the first ${process.length} by schedule order for latency. Ask about a specific game for full coverage.`,
    );
  }
  if (games.length === 0) {
    warnings.push(`No MLB games are scheduled for ${ctx.date}.`);
  }

  const results = await Promise.all(
    process.map((g) => computeMarketGameCards(g.gamePk, marketKey, ctx.season).catch(() => null)),
  );
  const cards = results.flatMap((r) => r?.cards ?? []);
  return { cards, warnings, gamesProcessed: process.length, gamesTotal: games.length };
}
