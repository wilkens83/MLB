import { describe, it, expect } from "bun:test";
import { describeDataMode } from "./mode";

describe("data-mode model", () => {
  it("labels the free path HISTORICAL + MANUAL, never LIVE", () => {
    const s = describeDataMode({ live: false, freeCurrent: false, historical: true, manual: true, fixture: true });
    expect(s.liveVerified).toBe(false);
    expect(s.label).toBe("HISTORICAL + MANUAL");
    expect(s.modes).toContain("HISTORICAL");
    expect(s.modes).not.toContain("LIVE");
  });

  it("only shows LIVE when a credentialed provider is verified", () => {
    const s = describeDataMode({ live: true, freeCurrent: false, historical: true, manual: true, fixture: true });
    expect(s.label).toBe("LIVE");
    expect(s.liveVerified).toBe(true);
  });

  it("shows DEMO DATA when only fixtures are available", () => {
    const s = describeDataMode({ live: false, freeCurrent: false, historical: false, manual: false, fixture: true });
    expect(s.label).toBe("DEMO DATA");
  });

  it("reports NO DATA when nothing is available", () => {
    expect(describeDataMode({ live: false, freeCurrent: false, historical: false, manual: false, fixture: false }).label).toBe("NO DATA");
  });
});
