import { test, expect, describe } from "bun:test";
import { createMockProvider } from "./mock-provider";
import { buildToolRegistry } from "../tools";
import { makeSource } from "../schemas/sources";
import type { ProviderInput } from "./types";
import type { ChatToolContext, ToolResult } from "../tools/types";
import type { PriorTurnState } from "../server/conversation-types";

/* Canned tool outputs — the ONLY source of numbers. Any value in the response
   that isn't here would be a fabrication, which these tests guard against. */
const CANNED: Record<string, unknown> = {
  searchPlayers: (input: { query: string }) => ({
    query: input.query,
    count: 1,
    players: [{ playerId: input.query.includes("Soto") ? 2 : 1, name: input.query, position: "RF", team: "T" }],
    ambiguous: false,
  }),
  getPitcherStrikeoutRankings: () => ({
    date: "2026-07-31", season: 2026, market: "strikeouts", marketLabel: "Pitcher Strikeouts",
    gamesProcessed: 5, gamesTotal: 5,
    rows: [
      { playerId: 10, playerName: "Ace One", team: "AAA", opponent: "BBB", projection: 9, marketLine: 5.5, overProbability: 0.86, confidence: 70, gamePk: 1, lineupStatus: "probable" },
      { playerId: 11, playerName: "Ace Two", team: "CCC", opponent: "DDD", projection: 6, marketLine: 5.5, overProbability: 0.55, confidence: 60, gamePk: 2, lineupStatus: "probable" },
    ],
  }),
  getPlayerProjection: (input: { playerId: number; prop: string }) => ({
    playerId: input.playerId, playerName: "Ace One", team: "AAA", prop: input.prop, propLabel: "Pitcher Strikeouts",
    line: 5.5, projection: 9, overProbability: 0.86, underProbability: 0.14, confidence: 72,
    recommendation: "strong-over", edge: 0.13, fairAmerican: -170, expectedValue: 0.2, sampleSize: 20,
    season: 2026, lineupConfirmed: false, starterConfirmed: true,
    factors: ["Recent K-rate: +12%", "Opponent K% vs RHP: +8%"],
  }),
  comparePlayers: (input: { playerIdA: number; playerIdB: number }) => ({
    prop: "total_bases", propLabel: "Total Bases", line: 1.5, window: 15,
    a: { playerId: input.playerIdA, name: "Aaron Judge", team: "NYY", window: 15, average: 1.13, recentValues: [0, 2, 1], hitRateOverDefault: 0.27, sampleSize: 15 },
    b: { playerId: input.playerIdB, name: "Juan Soto", team: "NYM", window: 15, average: 1.27, recentValues: [1, 3, 0], hitRateOverDefault: 0.33, sampleSize: 15 },
    edge: "Juan Soto",
  }),
  getPrizePicksEdges: () => ({ date: "2026-07-31", count: 0, evaluated: 0, rows: [], unresolved: [] }),
};

function makeInput(message: string, priorState?: PriorTurnState): { input: ProviderInput; calls: string[] } {
  const calls: string[] = [];
  const context: ChatToolContext = {
    date: "2026-07-31", season: 2026, sport: "mlb", timezone: "UTC",
    log: () => {},
  };
  const invoke = async <T = unknown>(name: string, rawInput: unknown): Promise<ToolResult<T>> => {
    calls.push(name);
    const producer = CANNED[name];
    const data = typeof producer === "function" ? (producer as (i: unknown) => unknown)(rawInput) : (producer ?? {});
    return {
      data: data as T,
      sources: [makeSource({ name: "MLB Stats API", type: "mlb-stats-api", dataAsOf: Date.now() })],
      warnings: [],
      summary: `${name} ok`,
      rowCount: 1,
    };
  };
  const input: ProviderInput = {
    message,
    history: [],
    priorState,
    context,
    registry: buildToolRegistry(),
    systemPrompt: "test",
    invoke,
    recordToolCall: () => {},
  };
  return { input, calls };
}

describe("mock provider composition (offline, stubbed tools)", () => {
  test("pitcher rankings: uses tool data only, cites sources, flags dev mode", async () => {
    const provider = createMockProvider();
    const { input, calls } = makeInput("Which pitchers have the best strikeout projections today?");
    const { response } = await provider.respond(input);
    expect(calls).toContain("getPitcherStrikeoutRankings");
    expect(response.meta?.developmentMode).toBe(true);
    expect(response.sources.length).toBeGreaterThan(0);
    const table = response.blocks.find((b) => b.type === "table");
    expect(table?.type).toBe("table");
    if (table?.type === "table") {
      // Every projection value comes from the canned tool output — no fabrication.
      expect(table.rows.map((r) => r.projection)).toEqual([9, 6]);
    }
  });

  test("follow-up 'above 60%' re-runs the ranking and filters", async () => {
    const provider = createMockProvider();
    const prior: PriorTurnState = { kind: "pitcher-k-rankings", date: "2026-07-31", prop: "strikeouts" };
    const { input, calls } = makeInput("Only show players with a probability above 60%", prior);
    const { response } = await provider.respond(input);
    expect(calls).toContain("getPitcherStrikeoutRankings");
    const table = response.blocks.find((b) => b.type === "table");
    if (table?.type === "table") {
      expect(table.rows).toHaveLength(1); // only the 0.86 row survives
      expect(table.rows[0].over).toBe(0.86);
    }
  });

  test("comparison resolves both players by id, then compares", async () => {
    const provider = createMockProvider();
    const { input, calls } = makeInput("Compare Aaron Judge and Juan Soto");
    const { response } = await provider.respond(input);
    expect(calls.filter((c) => c === "searchPlayers")).toHaveLength(2);
    expect(calls).toContain("comparePlayers");
    expect(response.answer).toMatch(/Juan Soto/);
  });

  test("unsupported question is answered honestly with no tool calls and no sources", async () => {
    const provider = createMockProvider();
    const { input, calls } = makeInput("Which teams have the weakest bullpen today?");
    const { response } = await provider.respond(input);
    expect(calls).toHaveLength(0);
    expect(response.sources).toHaveLength(0);
    expect(response.warnings.join(" ")).toMatch(/bullpen/i);
  });

  test("missing PrizePicks board yields a clear no-data answer", async () => {
    const provider = createMockProvider();
    const { input } = makeInput("Which PrizePicks lines have the highest edge?");
    const { response } = await provider.respond(input);
    expect(response.answer).toMatch(/no prizepicks board/i);
  });

  test("every response validates and carries a generatedAt + suggestions", async () => {
    const provider = createMockProvider();
    const { input } = makeInput("Which pitchers have the best strikeout projections today?");
    const { response } = await provider.respond(input);
    expect(typeof response.generatedAt).toBe("string");
    expect(response.suggestedQuestions.length).toBeGreaterThan(0);
  });
});
