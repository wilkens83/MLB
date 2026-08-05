import { test, expect, describe } from "bun:test";
import { runPlayerPropWorkflow } from "./workflow";
import type { PlayerPropDeps, SeriesResult } from "./types";

/** Deterministic fixture adapter — no network. */
function fixtureDeps(series: number[], extra: Partial<SeriesResult> = {}): PlayerPropDeps {
  return {
    getSeries: async () => ({ series, sampleSize: series.length, ...extra }),
  };
}

// A realistic 20-game "hits" series.
const HITS = [1, 0, 2, 1, 1, 0, 3, 1, 2, 0, 1, 1, 2, 1, 0, 1, 2, 1, 1, 0];

describe("player-prop workflow", () => {
  test("happy path → ok/no-price recommendation with a full trace", async () => {
    const { result, trace } = await runPlayerPropWorkflow(
      { playerId: 592789, propKey: "hits", line: 0.5, overAmerican: -150 },
      fixtureDeps(HITS),
    );
    expect(result.ok).toBe(true);
    if (result.ok) expect(["ok", "no-price"]).toContain(result.value.status);
    // Trace covers the whole chain.
    expect(trace.nodes.map((n) => n.id)).toEqual([
      "loadSeries", "sampleQuality", "project", "simulate", "priceCompare", "verify", "recommend",
    ]);
    expect(trace.status === "ok" || trace.status === "degraded").toBe(true);
    // The simulation node recorded its simulation count.
    expect(trace.nodes.find((n) => n.id === "simulate")?.simulationCount).toBeGreaterThan(0);
  });

  test("no market price → status no-price, model probability, no EV", async () => {
    const { result } = await runPlayerPropWorkflow(
      { playerId: 1, propKey: "hits", line: 0.5 }, // no odds
      fixtureDeps(HITS),
    );
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.value.status).toBe("no-price");
      expect(result.value.probability).toBeGreaterThan(0);
      expect(result.value.ev).toBeUndefined();
    }
  });

  test("too few games → insufficient-data (clean stop, no recommendation)", async () => {
    const { result } = await runPlayerPropWorkflow(
      { playerId: 1, propKey: "hits", line: 0.5, minSample: 10 },
      fixtureDeps([1, 0, 1]),
    );
    expect(result.ok).toBe(true);
    if (result.ok) expect(result.value.status).toBe("insufficient-data");
  });

  test("temporal leakage → verification rejects the recommendation", async () => {
    const { result } = await runPlayerPropWorkflow(
      { playerId: 1, propKey: "hits", line: 0.5, overAmerican: -150 },
      fixtureDeps(HITS, { featureCutoff: "2026-07-31T23:30:00Z", eventStartTime: "2026-07-31T23:00:00Z" }),
    );
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.value.status).toBe("rejected");
      expect(result.value.warnings.join(" ")).toMatch(/LEAKAGE/);
    }
  });

  test("deterministic: same seed → identical probability", async () => {
    const run = () => runPlayerPropWorkflow(
      { playerId: 1, propKey: "hits", line: 0.5, seed: "fixed-seed" },
      fixtureDeps(HITS),
    );
    const a = await run();
    const b = await run();
    expect(a.result.ok && b.result.ok).toBe(true);
    if (a.result.ok && b.result.ok) {
      expect(a.result.value.probability).toBe(b.result.value.probability);
    }
  });

  test("adapter failure surfaces as a typed data-unavailable error (not a throw)", async () => {
    const failing: PlayerPropDeps = { getSeries: async () => { throw new Error("MLB down"); } };
    const { result, trace } = await runPlayerPropWorkflow(
      { playerId: 1, propKey: "hits", line: 0.5 }, failing,
    );
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.error.code).toBe("DATA_UNAVAILABLE");
    expect(trace.nodes[0].attempts).toBe(3); // retried per policy
  });
});
