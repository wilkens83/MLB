/* ============================================================================
   MLB data adapter for the player-prop workflow. This is the ONLY seam that
   touches the concrete MLB client; the workflow itself receives it by injection.
   Server-only (it reaches the network via the existing mlb/api layer).
   ========================================================================== */

import { getGameLog } from "@/lib/mlb/api";
import { extractPropSeries, seriesValues, statGroupForProp } from "@/lib/mlb/series";
import type { PlayerPropDeps, SeriesResult, PlayerPropInput } from "./types";

export const mlbSeriesAdapter: PlayerPropDeps = {
  async getSeries(input: PlayerPropInput): Promise<SeriesResult> {
    const group = statGroupForProp(input.propKey);
    const splits = await getGameLog(input.playerId, group, input.season);
    const samples = extractPropSeries(input.propKey, splits);
    const series = seriesValues(samples);
    return {
      series,
      sampleSize: series.length,
      // The game-log request is historical; the workflow's freshness verifier
      // treats a missing cutoff/event as "no leakage signal available".
      featureCutoff: undefined,
      eventStartTime: undefined,
    };
  },
};
