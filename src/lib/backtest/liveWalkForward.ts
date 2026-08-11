/* ============================================================================
   Live walk-forward adapter — the ONLY seam that touches the MLB network. It
   fetches multi-season game logs for the requested players/props, turns them into
   chronological `WalkForwardSeries` via the canonical prop extraction layer
   (`extractPropSeries` — no re-derived stat formulas), and runs the pure
   `runWalkForwardBacktest`. Server-only.

   PA (Model B) is NOT scored here: reconstructing point-in-time plate-appearance
   rates for every historical game is out of scope for this phase, so `paProbOver`
   is left undefined — the model is simply absent, never fabricated.
   ========================================================================== */

import { getMultiSeasonGameLog, getPlayer, getCurrentMlbSeason } from "@/lib/mlb/api";
import { extractPropSeries, seriesValues, statGroupForProp } from "@/lib/mlb/series";
import { getProp } from "@/lib/props/catalog";
import { runWalkForwardBacktest, type WalkForwardSeries, type WalkForwardReport } from "./walkForward";

export interface LiveWalkForwardInput {
  playerIds: number[];
  propKeys: string[];
  minimumHistory?: number;
  seasons?: number[];
}

export interface LiveWalkForwardResult extends WalkForwardReport {
  seriesBuilt: number;
  seriesSkipped: number;
  players: number;
}

/**
 * Build point-in-time series from real game logs and run the walk-forward
 * backtest. Fetches are bounded (Promise.all over the requested players × props);
 * callers cap the input sizes at the route boundary.
 */
export async function runLiveWalkForwardBacktest(input: LiveWalkForwardInput): Promise<LiveWalkForwardResult> {
  const minimumHistory = input.minimumHistory ?? 20;
  const seasons = input.seasons ?? [getCurrentMlbSeason() - 1, getCurrentMlbSeason()];
  const propKeys = input.propKeys.filter((k) => {
    const p = getProp(k);
    return p && (p.category === "batter" || p.category === "pitcher");
  });

  const seriesList: WalkForwardSeries[] = [];
  let skipped = 0;

  await Promise.all(
    input.playerIds.map(async (playerId) => {
      const person = await getPlayer(playerId).catch(() => null);
      const isPitcher = person?.primaryPosition?.abbreviation === "P";
      for (const propKey of propKeys) {
        const prop = getProp(propKey)!;
        // Only score props that match the player's role.
        if (prop.category === "pitcher" && !isPitcher) continue;
        if (prop.category === "batter" && isPitcher) continue;
        const group = statGroupForProp(propKey);
        const log = await getMultiSeasonGameLog(playerId, group, seasons).catch(() => []);
        const samples = extractPropSeries(propKey, log);
        const values = seriesValues(samples);
        if (values.length <= minimumHistory) { skipped++; continue; }
        seriesList.push({
          playerId,
          propKey,
          family: prop.family,
          values,
          dates: samples.map((s) => s.date ?? "").filter(Boolean).length === values.length
            ? samples.map((s) => s.date!) : undefined,
        });
      }
    }),
  );

  const report = runWalkForwardBacktest(seriesList, { minimumHistory, seed: "live" });
  return {
    ...report,
    seriesBuilt: seriesList.length,
    seriesSkipped: skipped,
    players: input.playerIds.length,
  };
}
