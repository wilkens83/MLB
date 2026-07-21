/* ============================================================================
   Slate builder — composes today's schedule into a navigable tree of games and
   their projected players (probable pitchers + projected batting orders) for
   the slate sidebar. All data is live: probable pitchers from the schedule,
   projected hitters from each team's most recent completed lineup.
   ========================================================================== */

import { getTodaysGames, getSchedule, getGame, getProjectedLineup, type LineupHitter } from "./api";
import { mapGame } from "@/lib/providers/mlbStats";
import type { GameEntity } from "@/lib/domain/models";

export interface SlatePlayer {
  id: number;
  name: string;
  position: string;
  battingOrder?: number;
  isPitcher: boolean;
  teamId: number;
  teamName: string;
  opponentId: number;
  opponentName: string;
  gamePk: number;
  venueName?: string;
  isHome: boolean;
  lineupStatus: "probable" | "projected" | "confirmed";
}

export interface SlateGameNode {
  gamePk: number;
  date: string;
  state: "preview" | "live" | "final";
  detailedState: string;
  venueName?: string;
  home: { teamId: number; teamName: string };
  away: { teamId: number; teamName: string };
  players: SlatePlayer[];
}

export interface Slate {
  date: string;
  games: SlateGameNode[];
  generatedAt: number;
}

function pitcherPlayer(
  p: { id: number; name: string } | undefined,
  teamId: number,
  teamName: string,
  oppId: number,
  oppName: string,
  gamePk: number,
  venueName: string | undefined,
  isHome: boolean,
): SlatePlayer | null {
  if (!p) return null;
  return {
    id: p.id,
    name: p.name,
    position: "P",
    isPitcher: true,
    teamId,
    teamName,
    opponentId: oppId,
    opponentName: oppName,
    gamePk,
    venueName,
    isHome,
    lineupStatus: "probable",
  };
}

function hitterPlayers(
  hitters: LineupHitter[],
  teamId: number,
  teamName: string,
  oppId: number,
  oppName: string,
  gamePk: number,
  venueName: string | undefined,
  isHome: boolean,
): SlatePlayer[] {
  return hitters.map((h) => ({
    id: h.id,
    name: h.name,
    position: h.position,
    battingOrder: h.battingOrder,
    isPitcher: false,
    teamId,
    teamName,
    opponentId: oppId,
    opponentName: oppName,
    gamePk,
    venueName,
    isHome,
    lineupStatus: "projected" as const,
  }));
}

/** Build the slate node (game + projected players) for a single game entity. */
export async function buildSlateGameNode(g: GameEntity): Promise<SlateGameNode> {
  const [homeLineup, awayLineup] = await Promise.all([
    getProjectedLineup(g.home.teamId).catch(() => []),
    getProjectedLineup(g.away.teamId).catch(() => []),
  ]);

  const players: SlatePlayer[] = [];
  const awayP = pitcherPlayer(
    g.away.probablePitcherId ? { id: g.away.probablePitcherId, name: g.away.probablePitcherName ?? "TBD" } : undefined,
    g.away.teamId, g.away.teamName, g.home.teamId, g.home.teamName, g.gamePk, g.venueName, false,
  );
  const homeP = pitcherPlayer(
    g.home.probablePitcherId ? { id: g.home.probablePitcherId, name: g.home.probablePitcherName ?? "TBD" } : undefined,
    g.home.teamId, g.home.teamName, g.away.teamId, g.away.teamName, g.gamePk, g.venueName, true,
  );
  if (awayP) players.push(awayP);
  if (homeP) players.push(homeP);
  players.push(
    ...hitterPlayers(awayLineup, g.away.teamId, g.away.teamName, g.home.teamId, g.home.teamName, g.gamePk, g.venueName, false),
    ...hitterPlayers(homeLineup, g.home.teamId, g.home.teamName, g.away.teamId, g.away.teamName, g.gamePk, g.venueName, true),
  );

  return {
    gamePk: g.gamePk,
    date: g.date,
    state: g.state,
    detailedState: g.detailedState,
    venueName: g.venueName,
    home: { teamId: g.home.teamId, teamName: g.home.teamName },
    away: { teamId: g.away.teamId, teamName: g.away.teamName },
    players,
  };
}

/** Fetch a single game and build its slate node (used by the market view). */
export async function buildSlateGame(gamePk: number): Promise<SlateGameNode | null> {
  const raw = await getGame(gamePk);
  if (!raw) return null;
  return buildSlateGameNode(mapGame(raw));
}

export async function buildSlate(dateIso?: string): Promise<Slate> {
  const rawGames = dateIso ? await getSchedule(dateIso) : await getTodaysGames();
  const games = rawGames.map(mapGame);
  const date = dateIso ?? new Date().toISOString().slice(0, 10);
  const nodes = await Promise.all(games.map((g) => buildSlateGameNode(g)));
  return { date, games: nodes, generatedAt: Date.now() };
}
