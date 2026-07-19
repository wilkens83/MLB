/* ============================================================================
   High-level MLB data access — typed functions the API routes and server
   components call. Each wraps the low-level client with sensible cache TTLs.
   ========================================================================== */

import { mlbGet } from "./client";
import type {
  MlbGame,
  MlbPerson,
  MlbTeam,
  PeopleResponse,
  ScheduleResponse,
  StatsResponse,
  StatGroup,
  TeamsResponse,
  GameLogSplit,
} from "./types";

const CURRENT_SEASON = 2026;

/** All active MLB teams. Cached for an hour — this rarely changes. */
export async function getTeams(): Promise<MlbTeam[]> {
  const res = await mlbGet<TeamsResponse>("/teams?sportId=1&activeStatus=Y", { ttl: 3600 });
  return res.teams.sort((a, b) => a.name.localeCompare(b.name));
}

/** Games for a given ISO date (YYYY-MM-DD), hydrated with pitchers + linescore. */
export async function getSchedule(date: string): Promise<MlbGame[]> {
  const res = await mlbGet<ScheduleResponse>(
    `/schedule?sportId=1&date=${date}&hydrate=probablePitcher,team,linescore,venue,weather`,
    { ttl: 45 },
  );
  return res.dates.flatMap((d) => d.games);
}

/** Today's games (server-local date). */
export async function getTodaysGames(now = new Date()): Promise<MlbGame[]> {
  const date = now.toISOString().slice(0, 10);
  return getSchedule(date);
}

/** Games currently in progress. */
export async function getLiveGames(now = new Date()): Promise<MlbGame[]> {
  const games = await getTodaysGames(now);
  return games.filter((g) => g.status.abstractGameState === "Live");
}

/** A single game by its gamePk, hydrated with pitchers, lineups, and linescore. */
export async function getGame(gamePk: number): Promise<MlbGame | null> {
  const res = await mlbGet<ScheduleResponse>(
    `/schedule?sportId=1&gamePks=${gamePk}&hydrate=probablePitcher,team,linescore,venue,lineups,weather`,
    { ttl: 30 },
  );
  return res.dates?.[0]?.games?.[0] ?? null;
}

/** Search players by name. */
export async function searchPlayers(query: string): Promise<MlbPerson[]> {
  const q = query.trim();
  if (q.length < 2) return [];
  const res = await mlbGet<PeopleResponse>(
    `/people/search?names=${encodeURIComponent(q)}&active=true`,
    { ttl: 300 },
  );
  return res.people ?? [];
}

/** Full player profile. */
export async function getPlayer(id: number): Promise<MlbPerson | null> {
  const res = await mlbGet<PeopleResponse>(
    `/people/${id}?hydrate=currentTeam`,
    { ttl: 600 },
  );
  return res.people?.[0] ?? null;
}

/** Season game log for a player in a given group. */
export async function getGameLog(
  playerId: number,
  group: StatGroup,
  season = CURRENT_SEASON,
): Promise<GameLogSplit[]> {
  const res = await mlbGet<StatsResponse>(
    `/people/${playerId}/stats?stats=gameLog&group=${group}&season=${season}`,
    { ttl: 300 },
  );
  const splits = res.stats?.[0]?.splits ?? [];
  return splits;
}

/**
 * Game log spanning multiple recent seasons, concatenated oldest→newest, so
 * early-season props still have a meaningful sample.
 */
export async function getMultiSeasonGameLog(
  playerId: number,
  group: StatGroup,
  seasons: number[] = [CURRENT_SEASON - 1, CURRENT_SEASON],
): Promise<GameLogSplit[]> {
  const logs = await Promise.all(seasons.map((s) => getGameLog(playerId, group, s).catch(() => [])));
  return logs.flat();
}

/** Roster for a team (used for player pickers by team). */
export async function getRoster(teamId: number): Promise<MlbPerson[]> {
  const res = await mlbGet<{ roster: { person: MlbPerson; position: MlbPerson["primaryPosition"] }[] }>(
    `/teams/${teamId}/roster?rosterType=active`,
    { ttl: 600 },
  );
  return (res.roster ?? []).map((r) => ({ ...r.person, primaryPosition: r.position }));
}

export { CURRENT_SEASON };
