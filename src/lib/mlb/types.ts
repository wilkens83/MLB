/* ============================================================================
   MLB Stats API — response and domain types (only the fields we consume).
   ========================================================================== */

export interface MlbTeam {
  id: number;
  name: string;
  abbreviation?: string;
  teamName?: string;
  locationName?: string;
  shortName?: string;
  division?: { id: number; name: string };
  league?: { id: number; name: string };
  venue?: { id: number; name: string };
}

export interface MlbPerson {
  id: number;
  fullName: string;
  firstName?: string;
  lastName?: string;
  primaryNumber?: string;
  currentTeam?: { id: number; name: string };
  primaryPosition?: { code: string; name: string; abbreviation: string };
  batSide?: { code: string; description: string };
  pitchHand?: { code: string; description: string };
  birthDate?: string;
  height?: string;
  weight?: number;
  active?: boolean;
}

export interface ProbablePitcher {
  id: number;
  fullName: string;
}

export interface GameTeamSide {
  team: MlbTeam;
  score?: number;
  isWinner?: boolean;
  probablePitcher?: ProbablePitcher;
  leagueRecord?: { wins: number; losses: number; pct: string };
}

export interface Linescore {
  currentInning?: number;
  inningState?: string;
  isTopInning?: boolean;
  scheduledInnings?: number;
  teams?: {
    home?: { runs?: number; hits?: number; errors?: number };
    away?: { runs?: number; hits?: number; errors?: number };
  };
  innings?: {
    num: number;
    home?: { runs?: number };
    away?: { runs?: number };
  }[];
}

export interface MlbGame {
  gamePk: number;
  gameDate: string;
  officialDate: string;
  gameType: string;
  status: { abstractGameState: string; detailedState: string; statusCode: string };
  teams: { away: GameTeamSide; home: GameTeamSide };
  venue?: { id: number; name: string };
  linescore?: Linescore;
  dayNight?: "day" | "night";
  doubleHeader?: string;
  seriesDescription?: string;
}

export interface ScheduleResponse {
  totalGames: number;
  dates: { date: string; games: MlbGame[] }[];
}

/** A single game's box-score stat line (subset used for props). */
export interface GameStatLine {
  gamesPlayed?: number;
  hits?: number;
  homeRuns?: number;
  doubles?: number;
  triples?: number;
  runs?: number;
  rbi?: number;
  totalBases?: number;
  strikeOuts?: number;
  baseOnBalls?: number;
  stolenBases?: number;
  atBats?: number;
  avg?: string;
  obp?: string;
  slg?: string;
  ops?: string;
  hitByPitch?: number;
  // pitching
  inningsPitched?: string;
  outs?: number;
  earnedRuns?: number;
  wins?: number;
  losses?: number;
  saves?: number;
  numberOfPitches?: number;
  strikes?: number;
  battersFaced?: number;
  whip?: string;
  era?: string;
}

export interface GameLogSplit {
  season?: string;
  date?: string;
  gameType?: string;
  isHome?: boolean;
  isWin?: boolean;
  opponent?: { id: number; name: string };
  team?: { id: number; name: string };
  stat: GameStatLine;
  game?: { gamePk: number };
}

export interface StatsResponse {
  stats: {
    type?: { displayName: string };
    group?: { displayName: string };
    splits: GameLogSplit[];
  }[];
}

export interface PeopleResponse {
  people: MlbPerson[];
}

export interface TeamsResponse {
  teams: MlbTeam[];
}

export type StatGroup = "hitting" | "pitching" | "fielding";
