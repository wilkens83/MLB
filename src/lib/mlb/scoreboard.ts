/* ============================================================================
   Scoreboard view model — the single normalization from a raw `MlbGame`
   (schedule + hydrated linescore) into the shape the Dashboard scoreboard
   renders. Pure + deterministic + dependency-free so it runs on the server, in
   the browser, and under the test runner.

   Honest-data contract: fields the MLB schedule linescore does not carry (last
   play, win/loss/save decisions, broadcast/highlight links) are left UNDEFINED
   here, never fabricated. The UI omits them cleanly. Base occupancy, balls,
   strikes, outs, current pitcher/batter, and R/H/E come straight from the
   hydrated linescore when the game is live.
   ========================================================================== */

import type { MlbGame } from "./types";

export type ScoreboardStatus = "live" | "final" | "scheduled" | "postponed" | "delayed";

export interface ScoreboardTeam {
  id: number;
  name: string;
  score?: number;
  record?: string; // "64-58" or undefined
  probablePitcher?: string;
  isWinner?: boolean;
}

export interface Rhe {
  runs?: number;
  hits?: number;
  errors?: number;
}

export interface BaseState {
  first: boolean;
  second: boolean;
  third: boolean;
}

export interface ScoreboardGame {
  gamePk: number;
  gameDate: string;
  status: ScoreboardStatus;
  /** Short human label: "Top 1st", "Mid 3rd", "Final", "7:10 PM", "Postponed". */
  statusLabel: string;
  away: ScoreboardTeam;
  home: ScoreboardTeam;
  rhe: { away: Rhe; home: Rhe };
  venue?: string;
  seriesDescription?: string;
  /** Present only for live games. */
  live?: {
    inningLabel: string;
    balls?: number;
    strikes?: number;
    outs?: number;
    bases: BaseState;
    /** True between half-innings (Middle/End) — no active batter. */
    midInning: boolean;
    pitcher?: string;
    batter?: string;
    dueUp?: string[];
  };
  /** Only genuinely-supported links — never a dead button. */
  actions: {
    /** Internal game detail page (exists at /games/[gamePk]). */
    gamecastUrl: string;
    /** Real external MLB Gameday link. */
    mlbUrl: string;
  };
}

const INNING_STATE_SHORT: Record<string, string> = {
  Top: "Top",
  Middle: "Mid",
  Bottom: "Bot",
  End: "End",
};

export function ordinal(n: number): string {
  const s = ["th", "st", "nd", "rd"];
  const v = n % 100;
  return `${n}${s[(v - 20) % 10] ?? s[v] ?? s[0]}`;
}

function recordOf(side: MlbGame["teams"]["away"]): string | undefined {
  const r = side.leagueRecord;
  return r && r.wins !== undefined && r.losses !== undefined ? `${r.wins}-${r.losses}` : undefined;
}

function startTime(iso: string): string {
  return new Date(iso).toLocaleTimeString("en-US", { hour: "numeric", minute: "2-digit" });
}

function classify(game: MlbGame): ScoreboardStatus {
  const abstract = game.status.abstractGameState;
  const detailed = (game.status.detailedState ?? "").toLowerCase();
  if (detailed.includes("postpon")) return "postponed";
  if (detailed.includes("delay") || detailed.includes("suspend")) return "delayed";
  if (abstract === "Live") return "live";
  if (abstract === "Final" || detailed.includes("final") || detailed.includes("game over")) return "final";
  return "scheduled";
}

function inningLabel(ls: MlbGame["linescore"]): string {
  const inning = ls?.currentInning;
  const state = ls?.inningState ? INNING_STATE_SHORT[ls.inningState] ?? ls.inningState : undefined;
  if (inning === undefined) return "Live";
  return state ? `${state} ${ordinal(inning)}` : ordinal(inning);
}

/** Normalize a raw game into the scoreboard view model. Pure + deterministic. */
export function toScoreboardGame(game: MlbGame): ScoreboardGame {
  const status = classify(game);
  const { away, home } = game.teams;
  const ls = game.linescore;

  const awayTeam: ScoreboardTeam = {
    id: away.team.id,
    name: away.team.name,
    score: away.score,
    record: recordOf(away),
    probablePitcher: away.probablePitcher?.fullName,
    isWinner: status === "final" ? away.isWinner : undefined,
  };
  const homeTeam: ScoreboardTeam = {
    id: home.team.id,
    name: home.team.name,
    score: home.score,
    record: recordOf(home),
    probablePitcher: home.probablePitcher?.fullName,
    isWinner: status === "final" ? home.isWinner : undefined,
  };

  const rhe = {
    away: { runs: ls?.teams?.away?.runs, hits: ls?.teams?.away?.hits, errors: ls?.teams?.away?.errors },
    home: { runs: ls?.teams?.home?.runs, hits: ls?.teams?.home?.hits, errors: ls?.teams?.home?.errors },
  };

  let statusLabel: string;
  if (status === "live") statusLabel = inningLabel(ls);
  else if (status === "final") statusLabel = "Final";
  else if (status === "postponed") statusLabel = "Postponed";
  else if (status === "delayed") statusLabel = game.status.detailedState || "Delayed";
  else statusLabel = startTime(game.gameDate);

  let live: ScoreboardGame["live"];
  if (status === "live" && ls) {
    const midInning = ls.inningState === "Middle" || ls.inningState === "End";
    const bases: BaseState = {
      first: !!ls.offense?.first,
      second: !!ls.offense?.second,
      third: !!ls.offense?.third,
    };
    const dueUp = midInning
      ? [ls.offense?.batter?.fullName, ls.offense?.onDeck?.fullName, ls.offense?.inHole?.fullName].filter(
          (x): x is string => !!x,
        )
      : undefined;
    live = {
      inningLabel: inningLabel(ls),
      balls: midInning ? undefined : ls.balls,
      strikes: midInning ? undefined : ls.strikes,
      outs: ls.outs,
      bases,
      midInning,
      pitcher: ls.defense?.pitcher?.fullName,
      batter: midInning ? undefined : ls.offense?.batter?.fullName,
      dueUp: dueUp && dueUp.length ? dueUp : undefined,
    };
  }

  return {
    gamePk: game.gamePk,
    gameDate: game.gameDate,
    status,
    statusLabel,
    away: awayTeam,
    home: homeTeam,
    rhe,
    venue: game.venue?.name,
    seriesDescription: game.seriesDescription,
    live,
    actions: {
      gamecastUrl: `/games/${game.gamePk}`,
      mlbUrl: `https://www.mlb.com/gameday/${game.gamePk}`,
    },
  };
}

/** Sort games live → scheduled → final, then by start time. */
export function sortScoreboardGames(games: ScoreboardGame[]): ScoreboardGame[] {
  const rank = (s: ScoreboardStatus) => (s === "live" ? 0 : s === "scheduled" || s === "delayed" ? 1 : s === "postponed" ? 2 : 3);
  return [...games].sort((a, b) => rank(a.status) - rank(b.status) || a.gameDate.localeCompare(b.gameDate));
}
