/* ============================================================================
   MLB data adapter for followed-player-performance@1. The ONLY seam that touches
   the concrete MLB client; the workflow receives it by injection. Server-only.

   A per-(player, metric) game-log request is fetched and turned into the
   oldest→newest prop series. A failed fetch propagates as a throw so the node
   degrades that player transparently (never fabricated). Season is resolved,
   never hard-coded (getGameLog defaults to getCurrentMlbSeason()).
   ========================================================================== */

import { getGameLog } from "@/lib/mlb/api";
import { extractPropSeries, statGroupForProp } from "@/lib/mlb/series";
import type { PropGameSample } from "@/lib/mlb/series";
import type { FollowedPerformanceDeps } from "./types";

export const mlbFollowedPerformanceAdapter: FollowedPerformanceDeps = {
  async getSeries({ playerId, metric }): Promise<PropGameSample[]> {
    const group = statGroupForProp(metric);
    const splits = await getGameLog(playerId, group);
    return extractPropSeries(metric, splits);
  },
};
