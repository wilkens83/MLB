import { test, expect, describe } from "bun:test";
import { chatResponseBlockSchema } from "./blocks";
import { chatAssistantResponseSchema } from "./response";
import { chatRequestSchema, CHAT_LIMITS } from "./request";
import { makeSource, dedupeSources, freshnessFor } from "./sources";

describe("block validation", () => {
  test("accepts a valid table block", () => {
    const r = chatResponseBlockSchema.safeParse({
      type: "table",
      columns: [{ key: "a", label: "A" }],
      rows: [{ a: 1 }],
    });
    expect(r.success).toBe(true);
  });
  test("rejects an unknown block type", () => {
    const r = chatResponseBlockSchema.safeParse({ type: "iframe", src: "evil" });
    expect(r.success).toBe(false);
  });
  test("rejects a table with no columns", () => {
    const r = chatResponseBlockSchema.safeParse({ type: "table", columns: [], rows: [] });
    expect(r.success).toBe(false);
  });
});

describe("assistant response validation", () => {
  const base = {
    answer: "ok",
    blocks: [],
    sources: [],
    warnings: [],
    suggestedQuestions: [],
    generatedAt: new Date().toISOString(),
  };
  test("accepts a minimal valid response", () => {
    expect(chatAssistantResponseSchema.safeParse(base).success).toBe(true);
  });
  test("rejects a response missing required fields", () => {
    expect(chatAssistantResponseSchema.safeParse({ answer: "x" }).success).toBe(false);
  });
});

describe("request validation (guardrails)", () => {
  test("rejects empty message", () => {
    expect(chatRequestSchema.safeParse({ message: "   " }).success).toBe(false);
  });
  test("rejects over-length message", () => {
    const long = "a".repeat(CHAT_LIMITS.maxMessageLength + 1);
    expect(chatRequestSchema.safeParse({ message: long }).success).toBe(false);
  });
  test("defaults sport to mlb", () => {
    const r = chatRequestSchema.safeParse({ message: "hi" });
    expect(r.success && r.data.sport).toBe("mlb");
  });
  test("rejects a malformed date", () => {
    expect(chatRequestSchema.safeParse({ message: "hi", date: "07-31-2026" }).success).toBe(false);
  });
});

describe("source citations + freshness", () => {
  test("mlb schedule minutes-old is live/fresh, hours-old is stale", () => {
    const now = Date.now();
    expect(freshnessFor("mlb-stats-api", now - 30_000, now)).toBe("live");
    expect(freshnessFor("mlb-stats-api", now - 10 * 60_000, now)).toBe("fresh");
    expect(freshnessFor("mlb-stats-api", now - 60 * 60_000, now)).toBe("stale");
  });
  test("prizepicks import is never 'live'", () => {
    const now = Date.now();
    const f = freshnessFor("prizepicks-import", now, now);
    expect(f).not.toBe("live");
  });
  test("missing dataAsOf yields unknown", () => {
    expect(freshnessFor("baseball-savant", undefined)).toBe("unknown");
  });
  test("makeSource derives freshnessStatus and unique ids", () => {
    const a = makeSource({ name: "MLB Stats API", type: "mlb-stats-api", dataAsOf: Date.now() });
    const b = makeSource({ name: "MLB Stats API", type: "mlb-stats-api", dataAsOf: Date.now() });
    expect(a.freshnessStatus).toBe("live");
    expect(a.id).not.toBe(b.id);
  });
  test("dedupeSources keeps one per (type,name,endpoint), freshest wins", () => {
    const older = makeSource({ name: "S", type: "mlb-stats-api", endpoint: "/x", dataAsOf: 1000 });
    const newer = makeSource({ name: "S", type: "mlb-stats-api", endpoint: "/x", dataAsOf: 5000 });
    const out = dedupeSources([older, newer]);
    expect(out).toHaveLength(1);
    expect(out[0].dataAsOf).toBe(new Date(5000).toISOString());
  });
});
