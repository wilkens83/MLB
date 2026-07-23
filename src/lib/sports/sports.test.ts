import { describe, it, expect } from "bun:test";
import { allSports, enabledSports, getSport, isSport, registerSport } from "./registry";
import { mlbAdapter } from "./mlbAdapter";
import { PROP_CATALOG } from "@/lib/props/catalog";
import type { SportAdapter, SportMarket } from "./types";

describe("sport registry", () => {
  it("registers MLB as the founding sport", () => {
    const mlb = getSport("mlb");
    expect(mlb).toBeDefined();
    expect(mlb!.label).toBe("MLB");
    expect(mlb!.enabled).toBe(true);
    expect(mlb!.adapter.key).toBe("mlb");
  });

  it("isSport type-guards known keys", () => {
    expect(isSport("mlb")).toBe(true);
    expect(isSport("cricket")).toBe(false);
  });

  it("enabledSports is a subset of allSports", () => {
    const all = allSports();
    const enabled = enabledSports();
    expect(enabled.length).toBeLessThanOrEqual(all.length);
    for (const s of enabled) expect(s.enabled).toBe(true);
  });

  it("registerSport is idempotent by key", () => {
    const before = allSports().length;
    const stub: SportAdapter = { key: "mlb", markets: () => [], getMarket: () => undefined };
    registerSport({
      key: "mlb", label: "MLB", tagline: "t", basePath: "/", icon: "Diamond",
      enabled: true, adapter: stub,
    });
    expect(allSports().length).toBe(before); // replaced, not appended
    // restore the real MLB registration for other tests / consumers
    registerSport({
      key: "mlb", label: "MLB", tagline: "Player-props analytics — projection + Monte Carlo + EV",
      basePath: "/", icon: "Diamond", enabled: true, adapter: mlbAdapter,
    });
  });
});

describe("mlb adapter", () => {
  it("exposes every catalog prop as a SportMarket", () => {
    const markets = mlbAdapter.markets();
    expect(markets.length).toBe(PROP_CATALOG.length);
    const keys = new Set(markets.map((m: SportMarket) => m.key));
    for (const p of PROP_CATALOG) expect(keys.has(p.key)).toBe(true);
  });

  it("maps catalog fields faithfully (no behavior change)", () => {
    const k = mlbAdapter.getMarket("strikeouts");
    expect(k).toBeDefined();
    expect(k!.distFamily).toBe("negbinom");
    expect(k!.group).toBe("pitcher");
    expect(k!.defaultLine).toBe(5.5);
  });

  it("returns undefined for unknown markets", () => {
    expect(mlbAdapter.getMarket("nope")).toBeUndefined();
  });
});
