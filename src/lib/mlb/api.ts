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
import { safeValidate } from "@/lib/schemas/validate";
import { scheduleSchema, peopleSchema, statsSchema } from "@/lib/schemas/mlb";

const CURRENT_SEASON = 2026;

/** All active MLB teams. Cached for an hour — this rarely changes. */
export async function getTeams(): Promise<MlbTeam[]> {
  const res = await mlbGet<TeamsResponse>("/teams?sportId=1&activeStatus=Y", { ttl: 3600 });
  return res.teams.sort((a, b) => a.name.localeCompare(b.name));
}

/** Games for a given ISO date (YYYY-MM-DD), hydrated with pitchers + linescore. */
export async function getSchedule(date: string): Promise<MlbGame[]> {
  const raw = await mlbGet<unknown>(
    `/schedule?sportId=1&date=${date}&hydrate=probablePitcher,team,linescore,venue,weather`,
    { ttl: 45 },
  );
  const res = safeValidate(scheduleSchema, raw, { dates: [] }, "schedule") as unknown as ScheduleResponse;
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
  const raw = await mlbGet<unknown>(
    `/schedule?sportId=1&gamePks=${gamePk}&hydrate=probablePitcher,team,linescore,venue,lineups,weather`,
    { ttl: 30 },
  );
  const res = safeValidate(scheduleSchema, raw, { dates: [] }, "game") as unknown as ScheduleResponse;
  return res.dates?.[0]?.games?.[0] ?? null;
}

/** Search players by name. */
export async function searchPlayers(query: string): Promise<MlbPerson[]> {
  const q = query.trim();
  if (q.length < 2) return [];
  const raw = await mlbGet<unknown>(
    `/people/search?names=${encodeURIComponent(q)}&active=true`,
    { ttl: 300 },
  );
  const res = safeValidate(peopleSchema, raw, { people: [] }, "search") as unknown as PeopleResponse;
  return res.people ?? [];
}

/** Full player profile. */
export async function getPlayer(id: number): Promise<MlbPerson | null> {
  const raw = await mlbGet<unknown>(`/people/${id}?hydrate=currentTeam`, { ttl: 600 });
  const res = safeValidate(peopleSchema, raw, { people: [] }, "player") as unknown as PeopleResponse;
  return res.people?.[0] ?? null;
}

/** Season game log for a player in a given group. */
export async function getGameLog(
  playerId: number,
  group: StatGroup,
  season = CURRENT_SEASON,
): Promise<GameLogSplit[]> {
  const raw = await mlbGet<unknown>(
    `/people/${playerId}/stats?stats=gameLog&group=${group}&season=${season}`,
    { ttl: 300 },
  );
  const res = safeValidate(statsSchema, raw, { stats: [] }, "gameLog") as unknown as StatsResponse;
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

export interface LineupHitter {
  id: number;
  name: string;
  position: string;
  battingOrder: number; // 1..9
}

interface BoxscorePlayer {
  person: { id: number; fullName: string };
  battingOrder?: string;
  position?: { abbreviation?: string };
}
interface BoxscoreResponse {
  teams?: {
    home?: { team?: { id: number }; batters?: number[]; players?: Record<string, BoxscorePlayer> };
    away?: { team?: { id: number }; batters?: number[]; players?: Record<string, BoxscorePlayer> };
  };
}

/** Extract the starting batting order (1–9) for one side of a boxscore. */
function extractLineup(side?: {
  batters?: number[];
  players?: Record<string, BoxscorePlayer>;
}): LineupHitter[] {
  if (!side?.players) return [];
  const out: LineupHitter[] = [];
  for (const p of Object.values(side.players)) {
    const order = Number(p.battingOrder);
    if (Number.isFinite(order) && order % 100 === 0 && order >= 100 && order <= 900) {
      out.push({
        id: p.person.id,
        name: p.person.fullName,
        position: p.position?.abbreviation ?? "",
        battingOrder: order / 100,
      });
    }
  }
  return out.sort((a, b) => a.battingOrder - b.battingOrder);
}

/** Home + away starting lineups from a completed game's boxscore. */
export async function getBoxscoreLineups(
  gamePk: number,
): Promise<{ homeTeamId?: number; awayTeamId?: number; home: LineupHitter[]; away: LineupHitter[] }> {
  const res = await mlbGet<BoxscoreResponse>(`/game/${gamePk}/boxscore`, { ttl: 3600 });
  return {
    homeTeamId: res.teams?.home?.team?.id,
    awayTeamId: res.teams?.away?.team?.id,
    home: extractLineup(res.teams?.home),
    away: extractLineup(res.teams?.away),
  };
}

/**
 * Projected lineup for a team: the batting order from that team's most recent
 * completed game. Real data (no fabrication); labeled "projected" in the UI
 * because official lineups only post ~1–2h before first pitch.
 */
export async function getProjectedLineup(teamId: number, now = new Date()): Promise<LineupHitter[]> {
  const end = now.toISOString().slice(0, 10);
  const start = new Date(now.getTime() - 6 * 86400000).toISOString().slice(0, 10);
  const raw = await mlbGet<unknown>(
    `/schedule?sportId=1&teamId=${teamId}&startDate=${start}&endDate=${end}`,
    { ttl: 600 },
  );
  const sched = safeValidate(scheduleSchema, raw, { dates: [] }, "teamSchedule") as unknown as ScheduleResponse;
  const finals = sched.dates
    .flatMap((d) => d.games)
    .filter((g) => g.status.abstractGameState === "Final")
    .sort((a, b) => b.gamePk - a.gamePk);
  const last = finals[0];
  if (!last) return [];
  const box = await getBoxscoreLineups(last.gamePk).catch(() => null);
  if (!box) return [];
  return box.homeTeamId === teamId ? box.home : box.away;
}

/** Roster for a team (used for player pickers by team). */
export async function getRoster(teamId: number): Promise<MlbPerson[]> {
  const res = await mlbGet<{ roster: { person: MlbPerson; position: MlbPerson["primaryPosition"] }[] }>(
    `/teams/${teamId}/roster?rosterType=active`,
    { ttl: 600 },
  );
  return (res.roster ?? []).map((r) => ({ ...r.person, primaryPosition: r.position }));
}

export interface PlayerSplit {
  code: string;
  label: string;
  games?: number;
  atBats?: number;
  avg?: string;
  obp?: string;
  slg?: string;
  ops?: string;
  hits?: number;
  homeRuns?: number;
  rbi?: number;
  strikeOuts?: number;
  baseOnBalls?: number;
  // pitching
  inningsPitched?: string;
  era?: string;
  whip?: string;
}

interface SplitsApiResponse {
  stats?: {
    splits?: {
      split?: { code?: string; description?: string };
      stat?: Record<string, unknown>;
    }[];
  }[];
}

/** Situational splits (home/away/day/night/vs LHP/vs RHP) for a player. */
export async function getPlayerSplits(
  playerId: number,
  group: StatGroup,
  season = CURRENT_SEASON,
): Promise<PlayerSplit[]> {
  const sitCodes = "h,a,d,n,vl,vr";
  const res = await mlbGet<SplitsApiResponse>(
    `/people/${playerId}/stats?stats=statSplits&group=${group}&season=${season}&sitCodes=${sitCodes}`,
    { ttl: 600 },
  );
  const splits = res.stats?.[0]?.splits ?? [];
  const numOr = (v: unknown): number | undefined => {
    const n = typeof v === "number" ? v : Number(v);
    return Number.isFinite(n) ? n : undefined;
  };
  const strOr = (v: unknown): string | undefined => (typeof v === "string" ? v : undefined);
  return splits.map((s) => {
    const st = s.stat ?? {};
    return {
      code: s.split?.code ?? "",
      label: s.split?.description ?? s.split?.code ?? "",
      games: numOr(st.gamesPlayed),
      atBats: numOr(st.atBats),
      avg: strOr(st.avg),
      obp: strOr(st.obp),
      slg: strOr(st.slg),
      ops: strOr(st.ops),
      hits: numOr(st.hits),
      homeRuns: numOr(st.homeRuns),
      rbi: numOr(st.rbi),
      strikeOuts: numOr(st.strikeOuts),
      baseOnBalls: numOr(st.baseOnBalls),
      inningsPitched: strOr(st.inningsPitched),
      era: strOr(st.era),
      whip: strOr(st.whip),
    };
  });
}

export { CURRENT_SEASON };
