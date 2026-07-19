import { test, expect, describe } from "bun:test";
import { hitRate, hitRateTable, streaks, consistency, trend, analyzeStat } from "./hitRate";

describe("hit rate", () => {
  const series = [0, 1, 2, 1, 0, 3, 1, 2, 1, 0]; // 10 games

  test("over rate vs 0.5", () => {
    const r = hitRate(series, 0.5, "over", 10);
    // games > 0.5 => the 7 non-zero games
    expect(r.hits).toBe(7);
    expect(r.rate).toBeCloseTo(0.7, 6);
  });
  test("window slices from the tail", () => {
    const r = hitRate(series, 0.5, "over", 5);
    expect(r.games).toBe(5);
  });
  test("under side is complementary for non-push lines", () => {
    const over = hitRate(series, 0.5, "over", 10);
    const under = hitRate(series, 0.5, "under", 10);
    expect(over.hits + under.hits).toBe(10);
  });
  test("table has all standard windows plus season", () => {
    const rows = hitRateTable(series, 0.5, "over");
    expect(rows.map((r) => String(r.window))).toEqual(["5", "10", "15", "20", "30", "season"]);
  });
});

describe("streaks", () => {
  test("current over streak counts trailing overs", () => {
    const s = streaks([0, 0, 1, 1, 1], 0.5, "over");
    expect(s.current).toBe(3);
    expect(s.longestOver).toBe(3);
  });
  test("current under streak is negative", () => {
    const s = streaks([2, 2, 0, 0], 0.5, "over");
    expect(s.current).toBe(-2);
  });
});

describe("consistency and trend", () => {
  test("steadier series scores higher consistency", () => {
    const steady = consistency([2, 2, 2, 2, 2, 2]);
    const volatile = consistency([0, 4, 0, 4, 0, 4]);
    expect(steady.score).toBeGreaterThan(volatile.score);
    expect(steady.score).toBeCloseTo(100, 0);
  });
  test("rising series has positive slope and up direction", () => {
    const t = trend([1, 2, 3, 4, 5, 6, 7, 8]);
    expect(t.slope).toBeGreaterThan(0);
    expect(t.direction).toBe("up");
  });
  test("analyzeStat bundles everything", () => {
    const a = analyzeStat([1, 2, 1, 0, 2, 1, 1, 2], 0.5, "over");
    expect(a.hitRates.length).toBe(6);
    expect(a.consistency.score).toBeGreaterThan(0);
    expect(a.series.length).toBe(8);
  });
});
