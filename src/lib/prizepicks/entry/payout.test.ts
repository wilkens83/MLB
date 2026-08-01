import { test, expect, describe } from "bun:test";
import { defaultPayoutTable, entryEconomics, type PrizePicksPayoutTable } from "./payout";

describe("versioned payout tables", () => {
  test("defaults are versioned, sourced, and effective-dated", () => {
    const t = defaultPayoutTable("flex", 5)!;
    expect(t.format).toBe("flex");
    expect(t.pickCount).toBe(5);
    expect(t.version).toMatch(/pp-default/);
    expect(t.source).toBe("manual-config");
    expect(t.effectiveFrom).toBeTruthy();
    expect(t.rules.length).toBeGreaterThan(1); // flex pays partials
  });

  test("unsupported size returns null (no invented economics)", () => {
    expect(defaultPayoutTable("power", 7)).toBeNull();
    expect(defaultPayoutTable("flex", 2)).toBeNull();
  });
});

describe("entryEconomics", () => {
  test("expected return = Σ P(k)·multiplier; profit = stake·(return−1)", () => {
    const table = defaultPayoutTable("power", 2)!; // {2: 3×}
    const dist = [0.3, 0.4, 0.3]; // P(0),P(1),P(2)
    const e = entryEconomics(table, dist, 10);
    expect(e.configured).toBe(true);
    expect(e.expectedReturn).toBeCloseTo(0.3 * 3, 6);
    expect(e.expectedProfit).toBeCloseTo(10 * (0.9 - 1), 6);
  });

  test("flex refund rule contributes to refundProbability", () => {
    const table = defaultPayoutTable("flex", 3)!; // 2-correct rule has refundMultiplier
    const dist = [0.1, 0.2, 0.5, 0.2];
    const e = entryEconomics(table, dist, 1);
    expect(e.refundProbability).toBeCloseTo(0.5, 6); // P(2 correct)
  });

  test("missing table → configured:false, EV withheld", () => {
    const e = entryEconomics(null, [0.5, 0.5], 1);
    expect(e.configured).toBe(false);
    expect(e.expectedReturn).toBeUndefined();
    expect(e.note).toMatch(/payout configuration required/i);
  });

  test("a custom verified-import table is honored verbatim", () => {
    const custom: PrizePicksPayoutTable = {
      id: "x", version: "promo-2026.9", effectiveFrom: "2026-07-01T00:00:00Z",
      format: "power", pickCount: 2, source: "verified-import", capturedAt: "2026-07-01T00:00:00Z",
      rules: [{ correctSelections: 2, payoutMultiplier: 4 }],
    };
    const e = entryEconomics(custom, [0.5, 0.3, 0.2], 1);
    expect(e.tableVersion).toBe("promo-2026.9");
    expect(e.expectedReturn).toBeCloseTo(0.2 * 4, 6);
  });
});
