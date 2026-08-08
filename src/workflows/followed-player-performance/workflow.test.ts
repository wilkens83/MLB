import { describe, it, expect } from "bun:test";
import { runFollowedPerformanceWorkflow } from "./workflow";
import type { FollowedPerformanceDeps, FollowedPlayerRequest } from "./types";
import type { PropGameSample } from "@/lib/mlb/series";

const FIXED_NOW = "2026-08-08T12:00:00Z";

function samples(values: number[]): PropGameSample[] {
  return values.map((value, i) => ({ value, date: `2026-08-${String(i + 1).padStart(2, "0")}` }));
}

/** Deterministic provider driven by a per-(player,metric) fixture map. */
function makeDeps(
  fixtures: Record<string, number[]>,
  opts: { fail?: Set<number>; onFetch?: (playerId: number) => void } = {},
): FollowedPerformanceDeps {
  return {
    now: () => FIXED_NOW,
    async getSeries({ playerId, metric }) {
      opts.onFetch?.(playerId);
      if (opts.fail?.has(playerId)) throw new Error("provider down");
      return samples(fixtures[`${playerId}:${metric}`] ?? []);
    },
  };
}

const judge: FollowedPlayerRequest = { playerId: 592450, displayName: "Aaron Judge", metrics: ["hits"], lines: { hits: 0.5 } };
const shohei: FollowedPlayerRequest = { playerId: 660271, displayName: "Shohei Ohtani", metrics: ["total_bases"] };

describe("followed-player-performance@1", () => {
  it("computes a HISTORICAL performance dashboard for followed players", async () => {
    const deps = makeDeps({
      "592450:hits": [1, 2, 0, 1, 2, 1, 0, 2, 1, 1],
      "660271:total_bases": [1, 0, 4, 2, 1],
    });
    const { result, trace } = await runFollowedPerformanceWorkflow([judge, shohei], deps);
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    const dash = result.value;
    expect(dash.totalFollowed).toBe(2);
    expect(dash.withData).toBe(2);
    expect(dash.computedAt).toBe(FIXED_NOW);
    expect(trace.status).toBe("ok");

    const judgeCard = dash.cards.find((c) => c.playerId === 592450)!;
    expect(judgeCard.available).toBe(true);
    expect(judgeCard.metrics[0].metric).toBe("hits");
    // prop history present because a line was supplied — HISTORICAL, not a model prob
    expect(judgeCard.metrics[0].propHistory).toBeDefined();
    const season = judgeCard.metrics[0].propHistory!.find((w) => w.window === "Season")!;
    expect(season).not.toHaveProperty("modelProbability");
    expect(season.overRate).not.toBeNull();
  });

  it("does NOT include prop history when no line is supplied", async () => {
    const deps = makeDeps({ "660271:total_bases": [1, 0, 4, 2, 1] });
    const { result } = await runFollowedPerformanceWorkflow([shohei], deps);
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    const card = result.value.cards[0];
    expect(card.metrics[0].propHistory).toBeUndefined();
  });

  it("degrades a failing player to unavailable without sinking the run", async () => {
    const deps = makeDeps(
      { "592450:hits": [1, 2, 1] },
      { fail: new Set([660271]) },
    );
    const { result } = await runFollowedPerformanceWorkflow([judge, shohei], deps);
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    const dash = result.value;
    expect(dash.totalFollowed).toBe(2);
    expect(dash.withData).toBe(1); // only Judge has data
    const shoheiCard = dash.cards.find((c) => c.playerId === 660271)!;
    expect(shoheiCard.available).toBe(false);
    expect(shoheiCard.error).toBeDefined();
    expect(shoheiCard.metrics.length).toBe(0);
  });

  it("reports available:false (never zero-filled) when a followed player has no games", async () => {
    const deps = makeDeps({}); // no fixtures → empty series
    const { result } = await runFollowedPerformanceWorkflow([judge], deps);
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    const card = result.value.cards[0];
    expect(card.available).toBe(false);
    expect(card.metrics[0].sampleSize).toBe(0);
    expect(card.metrics[0].windows.every((w) => w.average === null)).toBe(true);
  });

  it("dedups followed players by canonical id and respects the concurrency bound", async () => {
    let inFlight = 0;
    let maxInFlight = 0;
    const deps: FollowedPerformanceDeps = {
      now: () => FIXED_NOW,
      async getSeries({ metric }) {
        inFlight++;
        maxInFlight = Math.max(maxInFlight, inFlight);
        await new Promise((r) => setTimeout(r, 5));
        inFlight--;
        return samples(metric === "hits" ? [1, 2, 1] : [0, 1]);
      },
    };
    const players: FollowedPlayerRequest[] = [
      { playerId: 1, metrics: ["hits"] },
      { playerId: 1, metrics: ["hits"] }, // duplicate id → deduped
      { playerId: 2, metrics: ["hits"] },
      { playerId: 3, metrics: ["hits"] },
      { playerId: 4, metrics: ["hits"] },
      { playerId: 5, metrics: ["hits"] },
    ];
    const { result } = await runFollowedPerformanceWorkflow(players, deps, { concurrency: 2 });
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.value.totalFollowed).toBe(5); // deduped from 6
    expect(maxInFlight).toBeLessThanOrEqual(2); // concurrency bound respected
  });
});
