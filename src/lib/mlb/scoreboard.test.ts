import { describe, it, expect } from "bun:test";
import { toScoreboardGame, sortScoreboardGames, ordinal } from "./scoreboard";
import type { MlbGame } from "./types";

function game(over: Partial<MlbGame> = {}): MlbGame {
  return {
    gamePk: 1,
    gameDate: "2026-08-13T23:10:00Z",
    officialDate: "2026-08-13",
    gameType: "R",
    status: { abstractGameState: "Preview", detailedState: "Scheduled", statusCode: "S" },
    teams: {
      away: { team: { id: 140, name: "Rangers" }, leagueRecord: { wins: 60, losses: 61, pct: ".498" }, probablePitcher: { id: 1, fullName: "W. Urena" } },
      home: { team: { id: 108, name: "Angels" }, leagueRecord: { wins: 47, losses: 74, pct: ".388" } },
    },
    venue: { id: 1, name: "Angel Stadium" },
    ...over,
  };
}

describe("ordinal", () => {
  it("formats ordinals correctly", () => {
    expect(ordinal(1)).toBe("1st");
    expect(ordinal(2)).toBe("2nd");
    expect(ordinal(3)).toBe("3rd");
    expect(ordinal(9)).toBe("9th");
    expect(ordinal(11)).toBe("11th");
  });
});

describe("toScoreboardGame — scheduled", () => {
  const s = toScoreboardGame(game());
  it("classifies as scheduled with a start-time label and probable pitcher", () => {
    expect(s.status).toBe("scheduled");
    expect(s.statusLabel).toMatch(/\d{1,2}:\d{2}/);
    expect(s.away.probablePitcher).toBe("W. Urena");
    expect(s.live).toBeUndefined(); // no live state for scheduled games
  });
  it("renders team records", () => {
    expect(s.away.record).toBe("60-61");
    expect(s.home.record).toBe("47-74");
  });
});

describe("toScoreboardGame — live", () => {
  const g = game({
    status: { abstractGameState: "Live", detailedState: "In Progress", statusCode: "I" },
    linescore: {
      currentInning: 1, inningState: "Top", isTopInning: true,
      balls: 2, strikes: 1, outs: 2,
      teams: { away: { runs: 0, hits: 0, errors: 0 }, home: { runs: 0, hits: 0, errors: 1 } },
      offense: { batter: { fullName: "E. Duran" }, first: { fullName: "Runner" } },
      defense: { pitcher: { fullName: "W. Urena" } },
    },
  });
  const s = toScoreboardGame(g);

  it("labels the inning and surfaces count + bases + participants", () => {
    expect(s.status).toBe("live");
    expect(s.statusLabel).toBe("Top 1st");
    expect(s.live?.balls).toBe(2);
    expect(s.live?.strikes).toBe(1);
    expect(s.live?.outs).toBe(2);
    expect(s.live?.bases).toEqual({ first: true, second: false, third: false });
    expect(s.live?.pitcher).toBe("W. Urena");
    expect(s.live?.batter).toBe("E. Duran");
  });

  it("maps R/H/E from the linescore", () => {
    expect(s.rhe.home.errors).toBe(1);
    expect(s.rhe.away.runs).toBe(0);
  });

  it("mid-inning suppresses count + active batter and exposes due-up", () => {
    const mid = toScoreboardGame(game({
      status: { abstractGameState: "Live", detailedState: "In Progress", statusCode: "I" },
      linescore: {
        currentInning: 1, inningState: "Middle",
        outs: 3, balls: 0, strikes: 0,
        offense: { batter: { fullName: "S. Ohtani" }, onDeck: { fullName: "A. Pages" }, inHole: { fullName: "T. Edman" } },
      },
    }));
    expect(mid.statusLabel).toBe("Mid 1st");
    expect(mid.live?.midInning).toBe(true);
    expect(mid.live?.balls).toBeUndefined();
    expect(mid.live?.batter).toBeUndefined();
    expect(mid.live?.dueUp).toEqual(["S. Ohtani", "A. Pages", "T. Edman"]);
  });

  it("degrades to a safe 'Live' label when inning data is missing", () => {
    const bare = toScoreboardGame(game({ status: { abstractGameState: "Live", detailedState: "In Progress", statusCode: "I" }, linescore: {} }));
    expect(bare.statusLabel).toBe("Live");
    expect(bare.live?.bases).toEqual({ first: false, second: false, third: false });
  });
});

describe("toScoreboardGame — final", () => {
  const s = toScoreboardGame(game({
    status: { abstractGameState: "Final", detailedState: "Final", statusCode: "F" },
    teams: {
      away: { team: { id: 114, name: "Guardians" }, score: 0, isWinner: false },
      home: { team: { id: 116, name: "Tigers" }, score: 3, isWinner: true },
    },
    linescore: { teams: { away: { runs: 0, hits: 4, errors: 1 }, home: { runs: 3, hits: 6, errors: 1 } } },
  }));

  it("labels Final, marks the winner, exposes R/H/E, and shows no live state or count", () => {
    expect(s.status).toBe("final");
    expect(s.statusLabel).toBe("Final");
    expect(s.home.isWinner).toBe(true);
    expect(s.away.isWinner).toBe(false);
    expect(s.rhe.home.runs).toBe(3);
    expect(s.rhe.away.hits).toBe(4);
    expect(s.live).toBeUndefined(); // no balls/strikes/outs for final games
  });
});

describe("status edge cases + sorting + actions", () => {
  it("recognizes postponed and delayed", () => {
    expect(toScoreboardGame(game({ status: { abstractGameState: "Preview", detailedState: "Postponed", statusCode: "D" } })).status).toBe("postponed");
    expect(toScoreboardGame(game({ status: { abstractGameState: "Preview", detailedState: "Delayed: Rain", statusCode: "D" } })).status).toBe("delayed");
  });

  it("only exposes supported, non-fake action links", () => {
    const s = toScoreboardGame(game({ gamePk: 776 }));
    expect(s.actions.gamecastUrl).toBe("/games/776");
    expect(s.actions.mlbUrl).toBe("https://www.mlb.com/gameday/776");
  });

  it("sorts live first, then scheduled, then final", () => {
    const live = toScoreboardGame(game({ gamePk: 2, status: { abstractGameState: "Live", detailedState: "In Progress", statusCode: "I" } }));
    const sched = toScoreboardGame(game({ gamePk: 3 }));
    const final = toScoreboardGame(game({ gamePk: 4, status: { abstractGameState: "Final", detailedState: "Final", statusCode: "F" } }));
    const order = sortScoreboardGames([final, sched, live]).map((g) => g.status);
    expect(order).toEqual(["live", "scheduled", "final"]);
  });
});
