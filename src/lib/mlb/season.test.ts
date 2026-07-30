import { test, expect, describe } from "bun:test";
import { getMlbSeasonForDate, getCurrentMlbSeason, getSeasonPhase } from "./season";

// Helper: build a UTC date the resolver reads via getUTC* accessors.
const d = (iso: string) => new Date(iso);

describe("getMlbSeasonForDate", () => {
  test("mid-regular-season resolves to that calendar year (July 2026 → 2026)", () => {
    expect(getMlbSeasonForDate(d("2026-07-30T12:00:00Z"))).toBe(2026);
  });

  test("Opening-day months (Mar–Sep) resolve to the current year", () => {
    expect(getMlbSeasonForDate(d("2026-03-15T12:00:00Z"))).toBe(2026);
    expect(getMlbSeasonForDate(d("2026-04-01T12:00:00Z"))).toBe(2026);
    expect(getMlbSeasonForDate(d("2026-09-30T12:00:00Z"))).toBe(2026);
  });

  test("postseason (October, early November) stays on the same season year", () => {
    expect(getMlbSeasonForDate(d("2026-10-20T12:00:00Z"))).toBe(2026);
    expect(getMlbSeasonForDate(d("2026-11-05T12:00:00Z"))).toBe(2026);
  });

  test("deep offseason (Jan/Feb) resolves to the previous, most-recent season", () => {
    expect(getMlbSeasonForDate(d("2026-01-15T12:00:00Z"))).toBe(2025);
    expect(getMlbSeasonForDate(d("2026-02-28T12:00:00Z"))).toBe(2025);
  });

  test("a historical date resolves to the season it belonged to, never 'now'", () => {
    expect(getMlbSeasonForDate(d("2019-05-01T12:00:00Z"))).toBe(2019);
    expect(getMlbSeasonForDate(d("2021-08-10T12:00:00Z"))).toBe(2021);
    // Historical January maps back a year, exactly like the current-year rule.
    expect(getMlbSeasonForDate(d("2020-01-10T12:00:00Z"))).toBe(2019);
  });

  test("defaults to now and returns a plausible 4-digit season", () => {
    const s = getCurrentMlbSeason();
    expect(s).toBeGreaterThanOrEqual(2024);
    expect(s).toBeLessThanOrEqual(new Date().getUTCFullYear() + 1);
  });
});

describe("getSeasonPhase", () => {
  test("classifies the MLB calendar", () => {
    expect(getSeasonPhase(d("2026-01-15T12:00:00Z"))).toBe("offseason");
    expect(getSeasonPhase(d("2026-03-10T12:00:00Z"))).toBe("spring");
    expect(getSeasonPhase(d("2026-06-01T12:00:00Z"))).toBe("regular");
    expect(getSeasonPhase(d("2026-10-12T12:00:00Z"))).toBe("postseason");
    expect(getSeasonPhase(d("2026-12-01T12:00:00Z"))).toBe("offseason");
  });
});
