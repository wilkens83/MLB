import { test, expect, describe } from "bun:test";
import { isAvailableForCutoff, payloadHash, recordProjectionSnapshot, recordRawObservation } from "./scientific";

describe("point-in-time availability guard", () => {
  const cutoff = "2026-07-31T22:00:00Z";
  test("a fact available before the cutoff is usable", () => {
    expect(isAvailableForCutoff("2026-07-31T18:00:00Z", cutoff)).toBe(true);
  });
  test("a fact available exactly at the cutoff is usable", () => {
    expect(isAvailableForCutoff(cutoff, cutoff)).toBe(true);
  });
  test("a fact that only became available AFTER the cutoff is leakage — rejected", () => {
    expect(isAvailableForCutoff("2026-07-31T23:30:00Z", cutoff)).toBe(false);
  });
});

describe("payloadHash", () => {
  test("is deterministic and 8 hex chars", () => {
    const a = payloadHash({ x: 1, y: [2, 3] });
    const b = payloadHash({ x: 1, y: [2, 3] });
    expect(a).toBe(b);
    expect(a).toMatch(/^[0-9a-f]{8}$/);
  });
  test("changes when the payload changes", () => {
    expect(payloadHash({ x: 1 })).not.toBe(payloadHash({ x: 2 }));
  });
});

describe("writers are safe no-ops without a configured service role (tests / keyless dev)", () => {
  test("recordRawObservation returns null instead of throwing", async () => {
    const id = await recordRawObservation({
      source: "mlb", observation_type: "boxscore", entity_type: "player", entity_id: "1",
      effective_at: "2026-07-31T23:00:00Z", available_at: "2026-07-31T23:05:00Z",
      payload: { hits: 2 },
    });
    expect(id).toBeNull();
  });
  test("recordProjectionSnapshot returns null instead of throwing", async () => {
    const id = await recordProjectionSnapshot({
      market_key: "strikeouts", line: 5.5, model_version: "2.0.0", feature_version: "fv1",
      feature_cutoff: "2026-07-31T22:00:00Z", data_as_of: "2026-07-31T22:00:00Z",
      input_hash: "abc", config_checksum: "def",
    });
    expect(id).toBeNull();
  });
});
