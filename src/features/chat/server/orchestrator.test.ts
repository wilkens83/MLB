import { test, expect, describe } from "bun:test";
import { clampAndValidate, safeError, checkRateLimit } from "./orchestrator";
import { CHAT_LIMITS } from "../schemas/request";
import type { ChatAssistantResponse } from "../schemas/response";

describe("clampAndValidate", () => {
  test("clamps table rows to the guardrail", () => {
    const rows = Array.from({ length: CHAT_LIMITS.maxTableRows + 25 }, (_, i) => ({ a: i }));
    const res: ChatAssistantResponse = {
      answer: "x",
      blocks: [{ type: "table", columns: [{ key: "a", label: "A" }], rows }],
      sources: [],
      warnings: [],
      suggestedQuestions: [],
      generatedAt: new Date().toISOString(),
    };
    const out = clampAndValidate(res, "2026-07-31", 2026);
    const table = out.blocks[0];
    expect(table.type).toBe("table");
    if (table.type === "table") expect(table.rows.length).toBe(CHAT_LIMITS.maxTableRows);
  });

  test("an invalid response is replaced by a safe error", () => {
    const bad = { answer: "x", blocks: [{ type: "nope" }] } as unknown as ChatAssistantResponse;
    const out = clampAndValidate(bad, "2026-07-31", 2026);
    expect(out.warnings.length).toBeGreaterThan(0);
    expect(out.answer).toMatch(/invalid response/i);
  });
});

describe("safeError", () => {
  test("is itself a valid, warning-bearing response", () => {
    const e = safeError("2026-07-31", 2026, "boom");
    expect(e.answer).toBe("boom");
    expect(e.warnings).toContain("boom");
    expect(e.dataAsOf).toBe("2026-07-31");
  });
});

describe("rate limiting", () => {
  test("allows up to the per-minute cap then blocks", () => {
    const session = `rl-${Math.random()}`;
    const base = 1_000_000;
    for (let i = 0; i < CHAT_LIMITS.rateLimitPerMinute; i++) {
      expect(checkRateLimit(session, base + i)).toBe(true);
    }
    expect(checkRateLimit(session, base + CHAT_LIMITS.rateLimitPerMinute)).toBe(false);
  });

  test("the window slides — old hits expire", () => {
    const session = `rl2-${Math.random()}`;
    const t0 = 5_000_000;
    for (let i = 0; i < CHAT_LIMITS.rateLimitPerMinute; i++) checkRateLimit(session, t0 + i);
    // 61s later the earlier hits have aged out.
    expect(checkRateLimit(session, t0 + 61_000)).toBe(true);
  });
});
