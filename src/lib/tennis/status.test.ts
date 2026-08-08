import { describe, it, expect, beforeEach, afterEach } from "bun:test";
import { getTennisDataStatus } from "./status";
import { __resetHealth } from "./providers/health";

const PAID = ["SPORTRADAR_TENNIS_API_KEY", "SPORTSDATAIO_TENNIS_API_KEY", "API_TENNIS_API_KEY"];

beforeEach(() => { __resetHealth(); for (const k of PAID) delete process.env[k]; });
afterEach(() => { for (const k of PAID) delete process.env[k]; });

describe("tennis data status — free mode with NO paid credentials", () => {
  it("CRITICAL: all paid providers unconfigured but Tennis is still available (not 'unavailable')", () => {
    const s = getTennisDataStatus();
    expect(s.liveConfigured).toBe(false); // no paid provider verified
    expect(s.historicalConfigured).toBe(true); // free historical is ready
    // The active data mode is usable and NOT live.
    expect(s.dataMode.liveVerified).toBe(false);
    expect(s.dataMode.label).not.toBe("LIVE");
    expect(s.dataMode.modes).toContain("HISTORICAL");
    expect(s.dataMode.modes).toContain("MANUAL");
  });

  it("surfaces every data path with truthful status", () => {
    const s = getTennisDataStatus();
    const byName = Object.fromEntries(s.providers.map((p) => [p.name, p]));
    expect(byName["historical-free"].status).toBe("ready");
    expect(byName["historical-free"].mode).toBe("HISTORICAL");
    expect(byName["manual"].status).toBe("ready");
    expect(byName["demo-fixture"].mode).toBe("FIXTURE");
    // Paid providers are present and honestly unconfigured.
    expect(byName["sportradar"].status).toBe("unconfigured");
    expect(byName["sportradar"].mode).toBe("PAID_LIVE");
  });

  it("exposes free-dataset provenance + license (non-commercial, not hidden)", () => {
    const s = getTennisDataStatus();
    expect(s.freeDataset.manifest.licenseUse).toBe("research/non-commercial");
    expect(s.freeDataset.manifest.source).toContain("Sackmann");
    expect(s.freeDataset.coverage.atpMatches).toBeGreaterThan(0);
  });

  it("shows LIVE only when a paid provider is actually verified (never from key presence alone)", () => {
    process.env.API_TENNIS_API_KEY = "present-but-unverified";
    const s = getTennisDataStatus();
    // Key present but no verified call ⇒ configured_unverified ⇒ NOT live.
    expect(s.liveConfigured).toBe(false);
    expect(s.dataMode.label).not.toBe("LIVE");
  });
});
