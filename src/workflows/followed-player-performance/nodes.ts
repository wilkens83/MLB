/* ============================================================================
   followed-player-performance@1 nodes.

     resolveFollowed → computePerformance → assembleDashboard

   `computePerformance` fans out over followed players with BOUNDED CONCURRENCY
   (an internal pool capped by input.concurrency, default 4) so a large follow
   list never floods the MLB API. Each player's metrics are computed with the
   pure `buildMetricPerformance` (HISTORICAL only — no model probability). A
   provider failure degrades that player to `available:false` with an error note;
   the node ALWAYS returns ok() so one bad player never sinks the run.
   ========================================================================== */

import { z } from "zod";
import { defineNode } from "../graph/node";
import { ok } from "../graph/result";
import { buildMetricPerformance, type PlayerMetricPerformance } from "@/lib/players/performance";
import {
  followedPerformanceInputSchema,
  type FollowedPerformanceInput,
  type FollowedPerformanceDeps,
  type FollowedPlayerRequest,
  type FollowedPlayerCard,
  type FollowedPlayersDashboard,
} from "./types";

const custom = <T,>() => z.object({ facts: z.custom<T>() });
const readFacts = <T,>(i: Readonly<Record<string, unknown>>, id: string) => (i[id] as { facts: T }).facts;

const DEFAULT_CONCURRENCY = 4;

/** Bounded-concurrency map: at most `limit` tasks in flight at once. */
async function mapWithConcurrency<T, R>(
  items: readonly T[],
  limit: number,
  fn: (item: T, index: number) => Promise<R>,
): Promise<R[]> {
  const results = new Array<R>(items.length);
  let cursor = 0;
  const worker = async () => {
    while (true) {
      const i = cursor++;
      if (i >= items.length) return;
      results[i] = await fn(items[i], i);
    }
  };
  const workers = Array.from({ length: Math.min(Math.max(1, limit), items.length || 1) }, worker);
  await Promise.all(workers);
  return results;
}

interface ResolvedFacts {
  players: FollowedPlayerRequest[];
  concurrency: number;
}

/** node 1 — normalize the followed-player request list. */
export const resolveFollowedNode = defineNode({
  id: "resolveFollowed",
  description: "Normalize the followed-player list and clamp the fan-out concurrency.",
  inputSchema: followedPerformanceInputSchema,
  outputSchema: custom<ResolvedFacts>(),
  selectInput: (i) => followedPerformanceInputSchema.parse(i.input),
  run: async (input: FollowedPerformanceInput) => {
    // Dedup by canonical player id; keep only players with at least one metric.
    const seen = new Set<number>();
    const players: FollowedPlayerRequest[] = [];
    for (const p of input.players) {
      if (seen.has(p.playerId)) continue;
      seen.add(p.playerId);
      players.push({ ...p, metrics: [...new Set(p.metrics)] });
    }
    return ok({
      facts: {
        players,
        concurrency: input.concurrency ?? DEFAULT_CONCURRENCY,
      } satisfies ResolvedFacts,
    });
  },
});

/** node 2 — fan out (bounded) and compute each player's historical performance. */
export function computePerformanceNode(deps: FollowedPerformanceDeps) {
  const now = deps.now ?? (() => new Date().toISOString());
  return defineNode({
    id: "computePerformance",
    description: "Fetch each followed player's series (bounded concurrency) and compute HISTORICAL performance.",
    inputSchema: custom<ResolvedFacts>(),
    outputSchema: custom<FollowedPlayerCard[]>(),
    dependsOn: ["resolveFollowed"],
    costCategory: "io",
    timeoutMs: 30_000,
    selectInput: (i) => ({ facts: readFacts<ResolvedFacts>(i, "resolveFollowed") }),
    run: async (input) => {
      const { players, concurrency } = input.facts;
      const cards = await mapWithConcurrency(players, concurrency, async (p) => {
        const computedAt = now();
        try {
          const metrics: PlayerMetricPerformance[] = [];
          for (const metric of p.metrics) {
            const samples = await deps.getSeries({ playerId: p.playerId, metric });
            metrics.push(
              buildMetricPerformance(p.playerId, metric, samples, {
                line: p.lines?.[metric],
                computedAt,
              }),
            );
          }
          return {
            playerId: p.playerId,
            displayName: p.displayName,
            team: p.team,
            position: p.position,
            available: metrics.some((m) => m.available),
            metrics,
            computedAt,
          } satisfies FollowedPlayerCard;
        } catch (e) {
          // Degrade this player transparently — never fabricate a summary.
          return {
            playerId: p.playerId,
            displayName: p.displayName,
            team: p.team,
            position: p.position,
            available: false,
            metrics: [],
            computedAt,
            error: e instanceof Error ? e.message : "series unavailable",
          } satisfies FollowedPlayerCard;
        }
      });
      // Always ok — per-player failures are represented in the cards themselves.
      return ok({ facts: cards });
    },
  });
}

/** node 3 — assemble the dashboard summary. */
export function assembleDashboardNode(deps: FollowedPerformanceDeps) {
  const now = deps.now ?? (() => new Date().toISOString());
  return defineNode({
    id: "assembleDashboard",
    description: "Assemble the My Players dashboard from the per-player cards.",
    inputSchema: custom<FollowedPlayerCard[]>(),
    outputSchema: z.custom<FollowedPlayersDashboard>(),
    dependsOn: ["computePerformance"],
    selectInput: (i) => ({ facts: readFacts<FollowedPlayerCard[]>(i, "computePerformance") }),
    run: async (input) => {
      const cards = input.facts;
      return ok({
        cards,
        totalFollowed: cards.length,
        withData: cards.filter((c) => c.available).length,
        computedAt: now(),
      } satisfies FollowedPlayersDashboard);
    },
  });
}
