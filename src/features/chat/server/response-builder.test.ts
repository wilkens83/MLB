import { test, expect, describe } from "bun:test";
import {
  applyRankingFilters,
  buildRankingBlocks,
  buildGamesBlocks,
  buildProjectionBlocks,
  buildHealthBlocks,
} from "./response-builder";
import type { RankingRow, RankingOutput } from "../tools/mlb/rankings";
import type { PlayerProjectionOutput } from "../tools/mlb/get-player-projection";
import { chatResponseBlockSchema } from "../schemas/blocks";

const row = (over: number, proj: number, line: number, status = "projected"): RankingRow => ({
  playerId: 1,
  playerName: "P",
  team: "T",
  opponent: "O",
  projection: proj,
  marketLine: line,
  overProbability: over,
  confidence: 70,
  gamePk: 1,
  lineupStatus: status,
});

describe("applyRankingFilters", () => {
  const rows = [row(0.8, 7, 5.5), row(0.55, 5, 5.5), row(0.4, 4, 5.5)];
  test("filters by minimum over probability", () => {
    const { rows: out } = applyRankingFilters(rows, { minOverProbability: 0.6 });
    expect(out).toHaveLength(1);
    expect(out[0].overProbability).toBe(0.8);
  });
  test("belowLine keeps projection over the market line", () => {
    const { rows: out } = applyRankingFilters([row(0.5, 6, 5.5), row(0.5, 5, 5.5)], { belowLine: true });
    expect(out).toHaveLength(1);
    expect(out[0].projection).toBe(6);
  });
  test("handedness cannot be applied and is reported as a note", () => {
    const { rows: out, notes } = applyRankingFilters(rows, { handedness: "L" });
    expect(out).toHaveLength(rows.length);
    expect(notes.join(" ")).toMatch(/handedness/i);
  });
  test("limit truncates", () => {
    const { rows: out } = applyRankingFilters(rows, { limit: 2 });
    expect(out).toHaveLength(2);
  });
});

describe("block builders emit valid blocks", () => {
  const ranking: RankingOutput = {
    date: "2026-07-31",
    season: 2026,
    market: "strikeouts",
    marketLabel: "Pitcher Strikeouts",
    rows: [row(0.86, 9, 5.5, "probable")],
    gamesProcessed: 5,
    gamesTotal: 5,
  };
  test("ranking blocks validate against the block schema", () => {
    const { blocks } = buildRankingBlocks(ranking, "projection");
    for (const b of blocks) expect(chatResponseBlockSchema.safeParse(b).success).toBe(true);
  });
  test("empty games returns a clear no-data answer", () => {
    const { answer, blocks } = buildGamesBlocks({ date: "2026-07-31", count: 0, games: [] });
    expect(answer).toMatch(/no mlb games/i);
    expect(blocks).toHaveLength(0);
  });
  test("null projection returns a no-projection answer, no fabricated numbers", () => {
    const empty: PlayerProjectionOutput = {
      playerId: 1, playerName: "X", team: "", prop: "hits", propLabel: "Hits", line: 0.5,
      projection: null, overProbability: null, underProbability: null, confidence: null,
      recommendation: null, edge: null, fairAmerican: null, expectedValue: null,
      sampleSize: 0, season: 2026, lineupConfirmed: false, starterConfirmed: false, factors: [],
    };
    const { answer } = buildProjectionBlocks(empty);
    expect(answer).toMatch(/no projection/i);
  });
  test("health blocks validate and include a missing-data section", () => {
    const { blocks } = buildHealthBlocks({
      date: "2026-07-31", season: 2026, modelVersion: "2.0.0",
      providers: [{ name: "mlb-stats-api", requests: 3, failures: 0, avgResponseMs: 120, lastSuccessAt: null, healthy: true }],
      slate: { games: 10, gamesWithBothProbables: 9, gamesMissingProbable: 1 },
      missing: ["1 game(s) missing a confirmed probable pitcher."],
    });
    for (const b of blocks) expect(chatResponseBlockSchema.safeParse(b).success).toBe(true);
  });
});
