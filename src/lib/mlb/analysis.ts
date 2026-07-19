/* ============================================================================
   Server-side prop analysis orchestrator — fetches a player's game log from the
   live MLB API, extracts the series for the requested prop, applies contextual
   adjustments, and runs the full prediction engine. Returns a serializable
   payload for API routes and server components.
   ========================================================================== */

import { getPlayer, getGameLog, getMultiSeasonGameLog, CURRENT_SEASON } from "./api";
import { extractPropSeries, seriesValues, statGroupForProp, type PropGameSample } from "./series";
import { buildContext } from "./context";
import { analyzeProp, type PropAnalysis } from "@/lib/prediction/engine";
import { getProp } from "@/lib/props/catalog";
import type { Side } from "@/lib/analytics/hitRate";

export interface AnalysisRequest {
  playerId: number;
  propKey: string;
  line?: number;
  side?: Side;
  overAmerican?: number;
  underAmerican?: number;
  venueName?: string;
  tempF?: number;
  /** "home" | "away" | undefined — filters the series by venue split. */
  venueSplit?: "home" | "away";
  /** Limit to the most recent N games (e.g. L10). undefined = full sample. */
  lastN?: number;
  season?: number;
  multiSeason?: boolean;
}

export interface AnalysisPayload {
  player: {
    id: number;
    name: string;
    position: string;
    team: string;
    bats?: string;
    throws?: string;
  } | null;
  samples: PropGameSample[];
  analysis: PropAnalysis | null;
  meta: {
    propKey: string;
    line: number;
    sampleSize: number;
    filteredFrom: number;
    season: number;
  };
  error?: string;
}

export async function runAnalysis(req: AnalysisRequest): Promise<AnalysisPayload> {
  const prop = getProp(req.propKey);
  const season = req.season ?? CURRENT_SEASON;

  const [player, log] = await Promise.all([
    getPlayer(req.playerId).catch(() => null),
    (req.multiSeason
      ? getMultiSeasonGameLog(req.playerId, statGroupForProp(req.propKey))
      : getGameLog(req.playerId, statGroupForProp(req.propKey), season)
    ).catch(() => []),
  ]);

  const playerInfo = player
    ? {
        id: player.id,
        name: player.fullName,
        position: player.primaryPosition?.abbreviation ?? "",
        team: player.currentTeam?.name ?? "",
        bats: player.batSide?.code,
        throws: player.pitchHand?.code,
      }
    : null;

  if (!prop) {
    return {
      player: playerInfo,
      samples: [],
      analysis: null,
      meta: { propKey: req.propKey, line: 0, sampleSize: 0, filteredFrom: 0, season },
      error: "unknown_prop",
    };
  }

  let samples = extractPropSeries(req.propKey, log);
  const filteredFrom = samples.length;

  if (req.venueSplit === "home") samples = samples.filter((s) => s.isHome);
  else if (req.venueSplit === "away") samples = samples.filter((s) => s.isHome === false);
  if (req.lastN && req.lastN > 0) samples = samples.slice(Math.max(0, samples.length - req.lastN));

  const series = seriesValues(samples);
  const line = req.line ?? prop.defaultLine;

  const context = buildContext({
    propKey: req.propKey,
    venueName: req.venueName,
    tempF: req.tempF,
  });

  const analysis =
    series.length > 0
      ? analyzeProp({
          propKey: req.propKey,
          series,
          line,
          side: req.side,
          overAmerican: req.overAmerican,
          underAmerican: req.underAmerican,
          context,
          seed: `${req.playerId}:${req.propKey}:${line}`,
        })
      : null;

  return {
    player: playerInfo,
    samples,
    analysis,
    meta: {
      propKey: req.propKey,
      line,
      sampleSize: series.length,
      filteredFrom,
      season,
    },
  };
}
