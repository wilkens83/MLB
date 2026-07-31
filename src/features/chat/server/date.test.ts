import { test, expect, describe } from "bun:test";
import { resolveDate, parseWindow, isoDateInTimezone } from "./date";

describe("resolveDate", () => {
  const now = new Date("2026-07-31T18:00:00Z");
  test("explicit date wins", () => {
    expect(resolveDate("anything", "UTC", "2026-05-01", now).date).toBe("2026-05-01");
  });
  test("'today' resolves to the tz date", () => {
    expect(resolveDate("games today", "UTC", undefined, now).date).toBe("2026-07-31");
  });
  test("'tomorrow' shifts forward and flags future", () => {
    const r = resolveDate("who plays tomorrow", "UTC", undefined, now);
    expect(r.date).toBe("2026-08-01");
    expect(r.future).toBe(true);
  });
  test("'yesterday' shifts back", () => {
    expect(resolveDate("results yesterday", "UTC", undefined, now).date).toBe("2026-07-30");
  });
  test("an ISO date inside the message is used", () => {
    expect(resolveDate("slate on 2026-04-15 please", "UTC", undefined, now).date).toBe("2026-04-15");
  });
  test("defaults to today when no phrase present", () => {
    expect(resolveDate("best strikeouts", "UTC", undefined, now).date).toBe("2026-07-31");
  });
});

describe("parseWindow", () => {
  test("parses digits", () => {
    expect(parseWindow("last 15 games")).toBe(15);
    expect(parseWindow("last 7 starts")).toBe(7);
  });
  test("parses number words", () => {
    expect(parseWindow("over the last fifteen games")).toBe(15);
    expect(parseWindow("last seven games")).toBe(7);
  });
  test("returns undefined when absent", () => {
    expect(parseWindow("this season")).toBeUndefined();
  });
});

describe("isoDateInTimezone", () => {
  test("formats YYYY-MM-DD", () => {
    expect(isoDateInTimezone(new Date("2026-07-31T18:00:00Z"), "UTC")).toBe("2026-07-31");
  });
  test("a late-UTC time is still the prior day in a western tz", () => {
    // 01:00Z on Aug 1 is 21:00 previous day in New York.
    expect(isoDateInTimezone(new Date("2026-08-01T01:00:00Z"), "America/New_York")).toBe("2026-07-31");
  });
});
