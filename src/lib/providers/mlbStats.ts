/* ============================================================================
   MLBStatsProvider — maps the MLB Stats API layer (@/lib/mlb/api) into the
   normalized domain entities the analytics engine consumes.
   ========================================================================== */

import { getSchedule, getGame, getPlayer, getGameLog } from "@/lib/mlb/api";
import { extractPropSeries } from "@/lib/mlb/series";
import type { MlbGame, MlbPerson, GameLogSplit } from "@/lib/mlb/types";
import type { MLBStatsProvider } from "./types";
import type {
  GameEntity,
  GameSideEntity,
  GameLogEntry,
  Handedness,
  PlayerEntity,
} from "@/lib/domain/models";

function hand(code?: string): Handedness {
  if (code === "L" || code === "R" || code === "S") return code;
  return "unknown";
}

function mapSide(side: MlbGame["teams"]["home"]): GameSideEntity {
  return {
    teamId: side.team.id,
    teamName: side.team.name,
    score: side.score,
    isWinner: side.isWinner,
    probablePitcherId: side.probablePitcher?.id,
    probablePitcherName: side.probablePitcher?.fullName,
    wins: side.leagueRecord?.wins,
    losses: side.leagueRecord?.losses,
  };
}

export function mapGame(g: MlbGame): GameEntity {
  const abstract = g.status.abstractGameState;
  return {
    gamePk: g.gamePk,
    date: g.gameDate,
    state: abstract === "Live" ? "live" : abstract === "Final" ? "final" : "preview",
    detailedState: g.status.detailedState,
    venueName: g.venue?.name,
    dayNight: g.dayNight ?? "unknown",
    home: mapSide(g.teams.home),
    away: mapSide(g.teams.away),
    currentInning: g.linescore?.currentInning,
    inningState: g.linescore?.inningState,
  };
}

export function mapPlayer(p: MlbPerson): PlayerEntity {
  const isPitcher = p.primaryPosition?.abbreviation === "P";
  return {
    id: p.id,
    name: p.fullName,
    position: p.primaryPosition?.abbreviation ?? "",
    isPitcher,
    teamId: p.currentTeam?.id,
    teamName: p.currentTeam?.name,
    bats: hand(p.batSide?.code),
    throws: hand(p.pitchHand?.code),
    number: p.primaryNumber,
  };
}

/** Normalize a raw game-log split into a GameLogEntry with numeric stat bag. */
function mapSplit(sp: GameLogSplit): GameLogEntry {
  const stat: Record<string, number> = {};
  for (const [k, v] of Object.entries(sp.stat)) {
    const n = typeof v === "number" ? v : Number(v);
    if (Number.isFinite(n)) stat[k] = n;
  }
  return {
    date: sp.date,
    opponentId: sp.opponent?.id,
    opponentName: sp.opponent?.name,
    isHome: sp.isHome,
    gamePk: sp.game?.gamePk,
    stat,
  };
}

export const mlbStatsProvider: MLBStatsProvider = {
  name: "mlb-stats-api",

  async getSchedule(dateIso: string): Promise<GameEntity[]> {
    const games = await getSchedule(dateIso);
    return games.map(mapGame);
  },

  async getGame(gamePk: number): Promise<GameEntity | null> {
    const g = await getGame(gamePk);
    return g ? mapGame(g) : null;
  },

  async getPlayer(id: number): Promise<PlayerEntity | null> {
    const p = await getPlayer(id);
    return p ? mapPlayer(p) : null;
  },

  async getBatterGameLog(playerId: number, season?: number): Promise<GameLogEntry[]> {
    const log = await getGameLog(playerId, "hitting", season);
    return log.map(mapSplit);
  },

  async getPitcherGameLog(playerId: number, season?: number): Promise<GameLogEntry[]> {
    const log = await getGameLog(playerId, "pitching", season);
    return log.map(mapSplit);
  },
};

/** Re-export the prop-series extractor for provider consumers. */
export { extractPropSeries };
