import { describe, it, expect } from "bun:test";
import { buildHistory, buildHitRates } from "./assemble";
import { getMarketConfig, marketsForPlayerType, defaultMarketFor } from "./market-config";
import type { AnalysisPayload } from "@/lib/mlb/analysis";
import type { PropGameSample } from "@/lib/mlb/series";

function payload(values: number[], opponentTeam?: string): AnalysisPayload {
  const samples: PropGameSample[] = values.map((value, i) => ({
    value,
    date: `2026-06-${String(i + 1).padStart(2, "0")}`,
    opponent: "OPP",
    isHome: i % 2 === 0,
  }));
  return {
    player: { id: 1, name: "Test", position: "P", team: "PHI" },
    samples,
    analysis: null,
    statcast: {},
    opponent: opponentTeam
      ? { opponentTeam, gamePk: 5, venueName: "Park", lineupConfirmed: false, starterConfirmed: true }
      : null,
    breakdown: null,
    warnings: [],
    dataQuality: null,
    provenance: null,
    meta: { propKey: "strikeouts", line: 5.5, sampleSize: values.length, filteredFrom: values.length, season: 2026 },
    lastUpdated: Date.now(),
  };
}

describe("market config (catalog-driven, no fabricated markets)", () => {
  it("resolves a supported pitcher market with chart stat + suggested filters", () => {
    const cfg = getMarketConfig("strikeouts")!;
    expect(cfg.playerType).toBe("pitcher");
    expect(cfg.chartStat).toBe("strikeouts");
    expect(cfg.unit).toBe("K");
    expect(cfg.suggestedFilters.length).toBeGreaterThan(0);
    expect(cfg.allowedWindows).toContain(10);
  });

  it("returns undefined for an unsupported/team market rather than inventing one", () => {
    expect(getMarketConfig("nrfi")).toBeUndefined();
    expect(getMarketConfig("not_a_market")).toBeUndefined();
  });

  it("lists pitcher vs hitter markets separately and picks the right default", () => {
    expect(marketsForPlayerType(true).every((m) => m.playerType === "pitcher")).toBe(true);
    expect(marketsForPlayerType(false).every((m) => m.playerType === "batter")).toBe(true);
    expect(defaultMarketFor(true)).toBe("strikeouts");
    expect(defaultMarketFor(false)).toBe("hits");
  });
});

describe("recent-performance history", () => {
  it("classifies each game over/under vs the selected line", () => {
    const h = buildHistory(payload([10, 3, 7, 5]), 5.5, 10);
    // last entry is the upcoming placeholder (opponent set) — but no opponent here
    expect(h.map((p) => p.result)).toEqual(["over", "under", "over", "under"]);
  });

  it("appends an UPCOMING placeholder with null value that is not a result", () => {
    const h = buildHistory(payload([10, 3], "LAA"), 5.5, 10);
    const upcoming = h[h.length - 1];
    expect(upcoming.upcoming).toBe(true);
    expect(upcoming.value).toBeNull();
    expect(upcoming.result).toBeNull(); // future game never scored as a hit/miss
  });

  it("only charts the most recent `window` games", () => {
    const h = buildHistory(payload([1, 2, 3, 4, 5, 6, 7]), 3.5, 3);
    expect(h.length).toBe(3);
    expect(h.map((p) => p.value)).toEqual([5, 6, 7]);
  });
});

describe("historical hit rates (HISTORICAL only, never a model probability)", () => {
  it("computes over-rate as decided-hits/decided-games and exposes NO probability field", () => {
    const rates = buildHitRates(payload([10, 6, 7, 13, 5, 9]), 5.5);
    const season = rates.find((r) => r.window === "Season")!;
    expect(season.games).toBe(6);
    expect(season.hits).toBe(5); // 10,6,7,13,9 over; 5 under
    expect(season.overRate).toBeCloseTo(5 / 6, 6);
    // The record must not carry a probability-like field.
    expect(season).not.toHaveProperty("probability");
    expect(season).not.toHaveProperty("modelProbability");
    expect(season).not.toHaveProperty("calibratedProbability");
  });

  it("excludes pushes from the rate denominator on integer lines", () => {
    // line 6 → 6 is a push, excluded from denominator
    const rates = buildHitRates(payload([6, 7, 5, 6]), 6);
    const season = rates.find((r) => r.window === "Season")!;
    expect(season.hits).toBe(1); // only the 7 is over
    // decided games = 7 and 5 → 2; pushes (6,6) excluded
    expect(season.overRate).toBeCloseTo(1 / 2, 6);
  });

  it("windows the hit rate to L5/L10/L20/Season", () => {
    const rates = buildHitRates(payload([0, 0, 0, 0, 0, 10, 10, 10, 10, 10]), 5.5);
    const l5 = rates.find((r) => r.window === "L5")!;
    expect(l5.games).toBe(5);
    expect(l5.overRate).toBe(1); // last 5 all 10 (over)
    const season = rates.find((r) => r.window === "Season")!;
    expect(season.overRate).toBeCloseTo(0.5, 6);
  });
});
