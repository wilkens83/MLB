import { test, expect, describe } from "bun:test";
import { getDecisionStore, verifyImmutable } from "./store";
import type { DecisionResult } from "./types";

function result(decision: DecisionResult["decision"], line: number): DecisionResult {
  return {
    decision, subjectType: "LEG", market: "strikeouts", line,
    decisionPolicyId: "p", decisionPolicyVersion: "1.0.0", modelVersion: "2.0.0", configChecksum: "abc",
    generatedAt: new Date().toISOString(), featureCutoff: "2026-07-31T22:00:00Z", dataAsOf: "2026-07-31T22:00:00Z",
    reasons: [], vetoes: [],
  };
}

describe("immutable decision store", () => {
  test("a changed line creates a NEW record, never an edit", async () => {
    const store = getDecisionStore();
    const key = `judge:strikeouts:${Math.random()}`;
    const r1 = await store.record(key, result("NO_BET", 5.5));
    const r2 = await store.record(key, result("BET_MORE", 6.5));
    const hist = await store.history(key);
    expect(hist).toHaveLength(2);
    expect(hist[0].id).not.toBe(hist[1].id);
    expect(hist[0].result.line).toBe(5.5);
    expect((await store.latest(key))?.id).toBe(r2.id);
    expect(r1.id).not.toBe(r2.id);
  });

  test("stored result is immutable and content-hash verified", async () => {
    const store = getDecisionStore();
    const key = `imm:${Math.random()}`;
    const rec = await store.record(key, result("WAIT", 1.5));
    expect(verifyImmutable(rec)).toBe(true);
    // Attempting to mutate the frozen result throws or is ignored (frozen object).
    expect(() => {
      (rec.result as { line: number }).line = 99;
    }).toThrow();
    expect(rec.result.line).toBe(1.5);
  });

  test("grading is additive and does not mutate the decision", async () => {
    const store = getDecisionStore();
    const key = `grade:${Math.random()}`;
    const rec = await store.record(key, result("BET_MORE", 5.5));
    const before = rec.contentHash;
    await store.grade(rec.id, { result: "win", gradedAt: new Date().toISOString() });
    const after = await store.latest(key);
    expect(after?.grade?.result).toBe("win");
    expect(verifyImmutable(after!)).toBe(true);
    expect(after?.contentHash).toBe(before);
  });
});
