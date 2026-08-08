import { describe, it, expect } from "bun:test";
import { verifyMatches, verifyRankings, partitionMatches } from "./verify";
import type { TennisMatch, RankingSnapshot } from "../domain";

function match(over: Partial<TennisMatch> = {}): TennisMatch {
  return {
    id: "m1", tournamentId: "t", season: 2026, surface: "hard", environment: "unknown",
    format: "best_of_3", round: "final", state: "completed", startTime: "2026-08-08T13:00:00Z",
    home: { playerId: "p:1", playerName: "A", side: "home", isWinner: true },
    away: { playerId: "p:2", playerName: "B", side: "away", isWinner: false },
    sets: [{ homeGames: 6, awayGames: 4 }, { homeGames: 6, awayGames: 3 }],
    stats: [], externalIds: {}, sources: ["prov"], ...over,
  };
}

describe("verifyMatches", () => {
  it("passes a coherent completed match", () => {
    expect(verifyMatches([match()]).verdict).toBe("PASS");
  });

  it("rejects a player playing themselves", () => {
    const r = verifyMatches([match({ away: { playerId: "p:1", playerName: "A", side: "away" } })]);
    expect(r.verdict).toBe("REJECT");
    expect(r.issues.some((i) => i.code === "PLAYER_VS_SELF")).toBe(true);
  });

  it("rejects a winner inconsistent with the set score", () => {
    const r = verifyMatches([match({
      home: { playerId: "p:1", playerName: "A", side: "home", isWinner: true },
      sets: [{ homeGames: 4, awayGames: 6 }, { homeGames: 3, awayGames: 6 }], // away won both
    })]);
    expect(r.verdict).toBe("REJECT");
    expect(r.issues.some((i) => i.code === "WINNER_SCORE_MISMATCH")).toBe(true);
  });

  it("rejects an impossible set score", () => {
    expect(verifyMatches([match({ sets: [{ homeGames: 99, awayGames: 0 }] })]).verdict).toBe("REJECT");
  });

  it("rejects duplicate match ids in a batch", () => {
    const r = verifyMatches([match(), match()]);
    expect(r.issues.some((i) => i.code === "DUPLICATE_MATCH_ID")).toBe(true);
  });

  it("rejects a record with no provenance", () => {
    expect(verifyMatches([match({ sources: [] })]).verdict).toBe("REJECT");
  });

  it("warns (not rejects) on an unresolved surface marker", () => {
    const r = verifyMatches([match({ sources: ["prov", "surface:unresolved"] })]);
    expect(r.verdict).toBe("WARN");
  });
});

describe("partitionMatches", () => {
  it("keeps accepted matches and excludes rejected ones", () => {
    const good = match({ id: "good" });
    const bad = match({ id: "bad", away: { playerId: "p:1", playerName: "A", side: "away" } });
    const { accepted, rejected } = partitionMatches([good, bad]);
    expect(accepted.map((m) => m.id)).toEqual(["good"]);
    expect(rejected.map((r) => r.match.id)).toEqual(["bad"]);
  });
});

describe("verifyRankings", () => {
  const rk = (over: Partial<RankingSnapshot> = {}): RankingSnapshot => ({ playerId: "p:1", tour: "atp", asOf: "2026-08-01", rank: 1, points: 1000, ...over });

  it("rejects a non-positive rank", () => {
    expect(verifyRankings([rk({ rank: 0 })]).verdict).toBe("REJECT");
  });

  it("rejects negative points", () => {
    expect(verifyRankings([rk({ points: -5 })]).verdict).toBe("REJECT");
  });

  it("rejects a ranking published AFTER the feature cutoff (no leakage)", () => {
    const r = verifyRankings([rk({ asOf: "2026-08-10" })], { featureCutoff: "2026-08-08" });
    expect(r.verdict).toBe("REJECT");
    expect(r.issues.some((i) => i.code === "FUTURE_RANKING")).toBe(true);
  });

  it("permits a ranking published on/before the cutoff", () => {
    expect(verifyRankings([rk({ asOf: "2026-08-07" })], { featureCutoff: "2026-08-08" }).verdict).toBe("PASS");
  });
});
