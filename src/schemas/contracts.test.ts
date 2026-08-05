import { test, expect, describe } from "bun:test";
import { simulationResultSchema, recommendationSchema, probabilityEstimateSchema } from "./analysis";
import { playerSchema, marketPriceSchema, gameSchema } from "./domain";
import { workflowTraceSchema } from "./workflow";

describe("analysis contracts reject invalid runtime data", () => {
  test("simulation probabilities must sum to ~1", () => {
    expect(simulationResultSchema.safeParse({
      pOver: 0.6, pUnder: 0.6, pPush: 0, mean: 1, stdDev: 1, iterations: 10000,
    }).success).toBe(false);
    expect(simulationResultSchema.safeParse({
      pOver: 0.6, pUnder: 0.39, pPush: 0.01, mean: 1, stdDev: 1, iterations: 10000,
    }).success).toBe(true);
  });

  test("a probability outside [0,1] is rejected", () => {
    expect(probabilityEstimateSchema.safeParse({ side: "over", probability: 1.2, method: "blended" }).success).toBe(false);
    expect(probabilityEstimateSchema.safeParse({ side: "over", probability: NaN, method: "blended" }).success).toBe(false);
  });

  test("recommendation status is constrained", () => {
    expect(recommendationSchema.safeParse({ status: "ok", side: "over", probability: 0.6, warnings: [] }).success).toBe(true);
    expect(recommendationSchema.safeParse({ status: "definitely-bet", warnings: [] }).success).toBe(false);
  });
});

describe("domain contracts", () => {
  test("a player requires an MLBAM id (never name-only)", () => {
    expect(playerSchema.safeParse({ name: "X", isPitcher: false }).success).toBe(false);
    expect(playerSchema.safeParse({ id: 592789, name: "Aaron Judge", isPitcher: false }).success).toBe(true);
  });
  test("market price is numeric american odds at the boundary", () => {
    expect(marketPriceSchema.safeParse({ line: 1.5, overAmerican: -120 }).success).toBe(true);
    expect(marketPriceSchema.safeParse({ line: 1.5, overAmerican: 1.5 }).success).toBe(false); // not an int
  });
  test("game requires a positive gamePk", () => {
    expect(gameSchema.safeParse({ gamePk: 0, date: "2026-07-31", homeTeam: { name: "A" }, awayTeam: { name: "B" } }).success).toBe(false);
  });
});

describe("workflow trace contract", () => {
  test("a well-formed trace validates", () => {
    const trace = {
      workflowId: "w", executionId: "e", status: "ok",
      startedAt: 1, completedAt: 2, durationMs: 1,
      nodes: [{ id: "n", status: "ok", attempts: 1, startedAt: 1, completedAt: 2, durationMs: 1, warnings: [], cost: "cpu" }],
      warnings: [],
    };
    expect(workflowTraceSchema.safeParse(trace).success).toBe(true);
  });
});
