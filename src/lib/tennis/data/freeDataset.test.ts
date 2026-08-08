import { describe, it, expect } from "bun:test";
import {
  getFreeDataset, buildFreeDataset, searchFreePlayers, getFreePlayer,
  freeRankingsAsOf, freePlayerMatches, createHistoricalFreeProvider,
} from "./freeDataset";
import { zTennisMatch, zTennisPlayer, zRankingSnapshot } from "../schemas/tennis";

describe("free historical dataset", () => {
  const ds = getFreeDataset();

  it("loads real curated matches/players/rankings and computes coverage", () => {
    expect(ds.coverage.atpMatches).toBeGreaterThan(0);
    expect(ds.coverage.wtaMatches).toBeGreaterThan(0);
    expect(ds.coverage.atpPlayers).toBeGreaterThan(0);
    expect(ds.coverage.wtaPlayers).toBeGreaterThan(0);
    expect(ds.coverage.rankingObservations).toBeGreaterThan(0);
    expect(ds.coverage.parseFailures).toBe(0);
    expect(ds.coverage.yearsCovered).toContain(2024);
  });

  it("emits domain-valid records", () => {
    expect(zTennisMatch.safeParse(ds.matches[0]).success).toBe(true);
    expect(zTennisPlayer.safeParse(ds.players[0]).success).toBe(true);
    expect(zRankingSnapshot.safeParse(ds.rankings[0]).success).toBe(true);
  });

  it("namespaces match ids by tour so ATP/WTA never collide", () => {
    const ids = ds.matches.map((m) => m.id);
    expect(new Set(ids).size).toBe(ids.length); // no duplicates
    expect(ids.every((id) => id.startsWith("atp:") || id.startsWith("wta:"))).toBe(true);
  });

  it("keeps missing values undefined, never zero (blank ranking points)", () => {
    // The seed intentionally leaves ranking points blank.
    expect(ds.rankings.every((r) => r.points === undefined)).toBe(true);
    // The AO SF row has no serve stats → surfaced as missing, not zero.
    expect(ds.coverage.matchesWithoutServeStats).toBeGreaterThan(0);
  });

  it("preserves player bio (dob/country/hand) without fabrication", () => {
    const alcaraz = getFreePlayer("csv:207989");
    expect(alcaraz?.fullName).toBe("Carlos Alcaraz");
    expect(alcaraz?.dateOfBirth).toBe("2003-05-05");
    expect(alcaraz?.countryCode).toBe("ESP");
    expect(alcaraz?.plays).toBe("right");
    expect(alcaraz?.backhand).toBe("unknown"); // not in source ⇒ unknown, not fabricated
  });

  it("player search is accent-insensitive", () => {
    expect(searchFreePlayers("swiatek").some((p) => p.fullName === "Iga Swiatek")).toBe(true);
    expect(searchFreePlayers("ŚWIĄTEK").some((p) => p.fullName === "Iga Swiatek")).toBe(true);
    expect(searchFreePlayers("").length).toBe(0);
  });

  it("links player ids to match sides", () => {
    const matches = freePlayerMatches("csv:207989");
    expect(matches.length).toBeGreaterThan(0);
    expect(matches.every((m) => m.home.playerId === "csv:207989" || m.away.playerId === "csv:207989")).toBe(true);
  });

  it("rankings are point-in-time (no future ranking for an earlier cutoff)", () => {
    const early = freeRankingsAsOf("atp", "2024-06-15");
    const late = freeRankingsAsOf("atp", "2024-09-30");
    // On 2024-06-10 Djokovic (csv:104925) was #1; by 2024-09-09 Sinner (csv:206173) is #1.
    expect(early.find((r) => r.rank === 1)?.playerId).toBe("csv:104925");
    expect(late.find((r) => r.rank === 1)?.playerId).toBe("csv:206173");
    // A cutoff before any ranking yields nothing (no leakage).
    expect(freeRankingsAsOf("atp", "2024-01-01").length).toBe(0);
  });

  it("is deterministic across rebuilds", () => {
    const a = buildFreeDataset();
    const b = buildFreeDataset();
    expect(a.matches.length).toBe(b.matches.length);
    expect(a.coverage).toEqual(b.coverage);
  });
});

describe("historical-free provider", () => {
  const p = createHistoricalFreeProvider();
  it("is READY on the free corpus and serves results/rankings/players (never schedule)", async () => {
    expect(p.status()).toBe("ready");
    expect(await p.getSchedule({ dateIso: "2024-09-08" })).toEqual([]);
    const results = await p.getMatchResults({ tour: "atp", season: 2024 });
    expect(results.length).toBeGreaterThan(0);
    expect(results.every((m) => m.state === "completed")).toBe(true);
    const rankings = await p.getRankings("atp", "2024-09-30");
    expect(rankings.length).toBeGreaterThan(0);
    const player = await p.getPlayer("csv:206173");
    expect(player?.fullName).toBe("Jannik Sinner");
  });
});
