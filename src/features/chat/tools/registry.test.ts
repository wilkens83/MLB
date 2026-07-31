import { test, expect, describe } from "bun:test";
import { buildToolRegistry, ALL_TOOLS } from "./index";

describe("tool registry", () => {
  test("registers every tool and lists them", () => {
    const reg = buildToolRegistry();
    expect(reg.list().length).toBe(ALL_TOOLS.length);
    expect(reg.has("getTodaysGames")).toBe(true);
    expect(reg.get("getPitcherStrikeoutRankings")?.domain).toBe("mlb");
  });

  test("throws on duplicate registration", () => {
    const reg = buildToolRegistry();
    const tool = reg.get("getTodaysGames")!;
    expect(() => reg.register(tool)).toThrow(/Duplicate/);
  });

  test("forSport filters by domain and includes system tools", () => {
    const reg = buildToolRegistry();
    const mlb = reg.forSport("mlb").map((t) => t.name);
    expect(mlb).toContain("getTodaysGames");
    expect(mlb).toContain("getDataHealth"); // system domain, cross-cutting
    expect(mlb).not.toContain("getPrizePicksEdges");
    const pp = reg.forSport("prizepicks").map((t) => t.name);
    expect(pp).toContain("getPrizePicksEdges");
  });

  test("catalog exposes name+description+domain only", () => {
    const reg = buildToolRegistry();
    const cat = reg.catalog();
    expect(cat.every((c) => c.name && c.description && c.domain)).toBe(true);
  });
});

describe("tool input validation", () => {
  test("searchPlayers requires a 2+ char query", () => {
    const reg = buildToolRegistry();
    const schema = reg.get("searchPlayers")!.inputSchema;
    expect(schema.safeParse({ query: "a" }).success).toBe(false);
    expect(schema.safeParse({ query: "Judge" }).success).toBe(true);
  });

  test("getPlayerProjection requires playerId + prop", () => {
    const reg = buildToolRegistry();
    const schema = reg.get("getPlayerProjection")!.inputSchema;
    expect(schema.safeParse({ prop: "strikeouts" }).success).toBe(false);
    expect(schema.safeParse({ playerId: 592450, prop: "home_runs" }).success).toBe(true);
  });

  test("ranking limit is bounded", () => {
    const reg = buildToolRegistry();
    const schema = reg.get("getPitcherStrikeoutRankings")!.inputSchema;
    expect(schema.safeParse({ limit: 999 }).success).toBe(false);
    expect(schema.safeParse({ limit: 10 }).success).toBe(true);
    expect(schema.safeParse({}).success).toBe(true);
  });
});
