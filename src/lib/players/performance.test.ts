import { describe, it, expect } from "bun:test";
import {
  windowSummaries,
  formTrend,
  variability,
  propHistory,
  buildMetricPerformance,
} from "./performance";
import type { PropGameSample } from "@/lib/mlb/series";

function samples(values: number[]): PropGameSample[] {
  return values.map((value, i) => ({ value, date: `2026-08-${String(i + 1).padStart(2, "0")}` }));
}

describe("window summaries (L5 / L10 / L20 / Season)", () => {
  it("computes averages over the correct trailing windows", () => {
    // 12 games, newest last. L5 = last 5, L10 = last 10, Season = all 12.
    const values = [0, 0, 0, 0, 0, 0, 0, 2, 2, 2, 2, 2];
    const w = windowSummaries(values);
    const byKey = Object.fromEntries(w.map((x) => [x.window, x]));
    expect(byKey.L5.games).toBe(5);
    expect(byKey.L5.average).toBe(2); // last 5 are all 2
    expect(byKey.L10.games).toBe(10);
    expect(byKey.Season.games).toBe(12);
    expect(byKey.Season.average).toBeCloseTo(10 / 12, 6);
  });

  it("reports null (never a fabricated 0) for an empty series", () => {
    const w = windowSummaries([]);
    for (const x of w) {
      expect(x.games).toBe(0);
      expect(x.average).toBeNull();
      expect(x.high).toBeNull();
    }
  });

  it("a window larger than the series just uses what exists (no padding)", () => {
    const w = windowSummaries([1, 3]);
    const l20 = w.find((x) => x.window === "L20")!;
    expect(l20.games).toBe(2);
    expect(l20.average).toBe(2);
    expect(l20.high).toBe(3);
    expect(l20.low).toBe(1);
  });
});

describe("trend direction is a rule over past games, not a forecast", () => {
  it("flags recent form above the season baseline", () => {
    // low early, high recent
    const values = [0, 0, 0, 0, 0, 0, 3, 3, 3, 3, 3, 3];
    const t = formTrend(values);
    expect(t.direction).toBe("above-baseline");
    expect(t.recentAverage).not.toBeNull();
  });

  it("flags recent form below the season baseline", () => {
    const values = [4, 4, 4, 4, 4, 4, 0, 0, 0, 0, 0, 0];
    expect(formTrend(values).direction).toBe("below-baseline");
  });

  it("reports insufficient-data below 3 games rather than guessing a trend", () => {
    expect(formTrend([2]).direction).toBe("insufficient-data");
    expect(formTrend([]).direction).toBe("insufficient-data");
  });
});

describe("variability is descriptive, never predictive", () => {
  it("reports zero spread for a constant series", () => {
    const v = variability([2, 2, 2, 2]);
    expect(v.stdDev).toBe(0);
    expect(v.range).toEqual([2, 2]);
    expect(v.sampleSize).toBe(4);
  });

  it("returns nulls for an empty series", () => {
    const v = variability([]);
    expect(v.stdDev).toBeNull();
    expect(v.range).toBeNull();
    expect(v.sampleSize).toBe(0);
  });
});

describe("prop history is HISTORICAL hit rate, kept separate from any model probability", () => {
  it("counts over/under against a line without pushes on a .5 line", () => {
    // hits: values against line 0.5 → over when >= 1
    const values = [0, 1, 2, 0, 1]; // 3 over, 2 under, 0 push
    const h = propHistory(values, 0.5);
    const season = h.find((x) => x.window === "Season")!;
    expect(season.over).toBe(3);
    expect(season.under).toBe(2);
    expect(season.push).toBe(0);
    expect(season.overRate).toBeCloseTo(3 / 5, 6);
    expect(season.underRate).toBeCloseTo(2 / 5, 6);
  });

  it("excludes pushes from the rate denominator on integer lines", () => {
    const values = [1, 1, 2, 0]; // line 1 → over:1 (the 2), under:1 (the 0), push:2
    const h = propHistory(values, 1);
    const season = h.find((x) => x.window === "Season")!;
    expect(season.over).toBe(1);
    expect(season.under).toBe(1);
    expect(season.push).toBe(2);
    expect(season.overRate).toBeCloseTo(0.5, 6); // 1 / (1+1), pushes excluded
  });

  it("returns null rates (not 0) when a window has no decided games", () => {
    const h = propHistory([], 0.5);
    for (const x of h) {
      expect(x.overRate).toBeNull();
      expect(x.underRate).toBeNull();
    }
  });
});

describe("buildMetricPerformance record", () => {
  const s = samples([0, 1, 2, 1, 0, 1, 2, 1, 0, 1, 2, 1]);

  it("is unavailable (never zero-filled) with no samples", () => {
    const perf = buildMetricPerformance(592450, "hits", []);
    expect(perf.available).toBe(false);
    expect(perf.sampleSize).toBe(0);
    expect(perf.propHistory).toBeUndefined();
    expect(perf.lastGame).toBeUndefined();
  });

  it("carries the canonical player id and metric label without conflating them", () => {
    const perf = buildMetricPerformance(592450, "hits", s);
    expect(perf.playerId).toBe(592450);
    expect(perf.metric).toBe("hits");
    expect(perf.available).toBe(true);
    expect(perf.lastGame?.value).toBe(1); // newest sample
  });

  it("includes prop history ONLY when a line is supplied, and never as a model probability", () => {
    const withoutLine = buildMetricPerformance(592450, "hits", s);
    expect(withoutLine.propHistory).toBeUndefined();

    const withLine = buildMetricPerformance(592450, "hits", s, { line: 0.5 });
    expect(withLine.propHistory).toBeDefined();
    // The record exposes descriptive over/under counts — there is no
    // probability field on it at all, so it cannot be read as a model output.
    const season = withLine.propHistory!.find((x) => x.window === "Season")!;
    expect(season).not.toHaveProperty("probability");
    expect(season).not.toHaveProperty("modelProbability");
    expect(season.overRate).not.toBeNull();
  });
});
