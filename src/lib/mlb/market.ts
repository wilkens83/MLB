/* ============================================================================
   Market view — computes lightweight analysis cards for every relevant player
   in a game for a chosen prop market. Cards are a fast screen (projection +
   analytic over/under + hit-rate windows + data quality); the full 10k Monte
   Carlo and explainable breakdown run on the detail/workspace views.
   ========================================================================== */

import { getProp, type PropDef } from "@/lib/props/catalog";
import { getGameLog, getCurrentMlbSeason } from "./api";
import { extractPropSeries, seriesValues, statGroupForProp } from "./series";
import { buildSlateGame } from "./slate";
import { project } from "@/lib/prediction/projection";
import { analyticOverProb } from "@/lib/prediction/simulate";
import { hitRate, trend, type Window } from "@/lib/analytics/hitRate";
import { parkMultiplierForProp } from "./context";
import { scoreDataQuality } from "@/lib/prediction/quality";
import { round } from "@/lib/utils";
import type { SlatePlayer } from "./slate";

export interface MarketCard {
  playerId: number;
  name: string;
  position: string;
  isPitcher: boolean;
  teamId: number;
  teamName: string;
  opponentId: number;
  opponentName: string;
  gamePk: number;
  isHome: boolean;
  battingOrder?: number;
  lineupStatus: string;
  venueName?: string;
  market: string;
  marketLabel: string;
  line: number;
  projection: number;
  overProb: number;
  underProb: number;
  hitRates: { l5: number; l10: number; l20: number; season: number };
  trend: "up" | "down" | "flat";
  dataQuality: number;
  sampleSize: number;
}

export interface MarketGameCards {
  gamePk: number;
  market: string;
  cards: MarketCard[];
  lastUpdated: number;
}

function relevantPlayers(players: SlatePlayer[], prop: PropDef): SlatePlayer[] {
  if (prop.category === "pitcher") return players.filter((p) => p.isPitcher);
  if (prop.category === "batter") return players.filter((p) => !p.isPitcher);
  // team/game markets: not player-level; return empty (handled elsewhere)
  return [];
}

async function cardFor(p: SlatePlayer, prop: PropDef, season: number): Promise<MarketCard | null> {
  const group = statGroupForProp(prop.key);
  const log = await getGameLog(p.id, group, season).catch(() => []);
  const samples = extractPropSeries(prop.key, log);
  const series = seriesValues(samples);
  if (series.length === 0) return null;

  const line = prop.defaultLine;
  const park = parkMultiplierForProp(prop.key, p.venueName);
  const projection = project({ series, family: prop.family, context: { park } });
  const overProb = analyticOverProb(projection, line);

  const hr = (n: Window) => hitRate(series, line, "over", n).rate;
  const dq = scoreDataQuality({
    sampleSize: series.length,
    hasStatcast: false, // card-level screen; detail view resolves Statcast
    hasOpponent: false,
    hasWeather: false,
    hasLineup: p.lineupStatus === "confirmed",
  });

  return {
    playerId: p.id,
    name: p.name,
    position: p.position,
    isPitcher: p.isPitcher,
    teamId: p.teamId,
    teamName: p.teamName,
    opponentId: p.opponentId,
    opponentName: p.opponentName,
    gamePk: p.gamePk,
    isHome: p.isHome,
    battingOrder: p.battingOrder,
    lineupStatus: p.lineupStatus,
    venueName: p.venueName,
    market: prop.key,
    marketLabel: prop.label,
    line,
    projection: round(projection.lambda, 2),
    overProb: round(overProb, 3),
    underProb: round(1 - overProb, 3),
    hitRates: {
      l5: round(hr(5), 3),
      l10: round(hr(10), 3),
      l20: round(hr(20), 3),
      season: round(hr("season"), 3),
    },
    trend: trend(series).direction,
    dataQuality: dq.score,
    sampleSize: series.length,
  };
}

/** Compute market cards for every relevant player in a single game. */
export async function computeMarketGameCards(
  gamePk: number,
  marketKey: string,
  season = getCurrentMlbSeason(),
): Promise<MarketGameCards> {
  const prop = getProp(marketKey);
  if (!prop) return { gamePk, market: marketKey, cards: [], lastUpdated: Date.now() };

  const node = await buildSlateGame(gamePk);
  if (!node) return { gamePk, market: marketKey, cards: [], lastUpdated: Date.now() };

  const players = relevantPlayers(node.players, prop);
  const cards = (await Promise.all(players.map((p) => cardFor(p, prop, season).catch(() => null)))).filter(
    (c): c is MarketCard => c !== null,
  );

  // Sort by over probability descending — the strongest overs first.
  cards.sort((a, b) => b.overProb - a.overProb);
  return { gamePk, market: marketKey, cards, lastUpdated: Date.now() };
}
