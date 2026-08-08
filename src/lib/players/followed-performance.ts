/* ============================================================================
   Server orchestrator for the My Players performance dashboard. Resolves each
   followed player's identity (name/team/position via the MLB API) to build a
   FollowedPlayerRequest with sensible default metrics + lines, then runs the
   followed-player-performance@1 graph workflow (bounded concurrency) over real
   MLB game logs.

   Identity is always the canonical MLBAM player id. Default metrics/lines come
   from the prop catalog. This computes HISTORICAL performance only — never a
   model probability. Server-only (touches the MLB network via mlb/api).
   ========================================================================== */

import { getPlayer } from "@/lib/mlb/api";
import { getProp } from "@/lib/props/catalog";
import {
  runFollowedPerformanceWorkflow,
  type FollowedPlayerRequest,
  type FollowedPlayersDashboard,
} from "@/workflows/followed-player-performance";
import { mlbFollowedPerformanceAdapter } from "@/workflows/followed-player-performance/mlb-adapter";

const PITCHER_METRICS = ["strikeouts"];
const BATTER_METRICS = ["hits", "total_bases"];

export interface FollowedPlayerInput {
  playerId: number;
  /** Optional explicit metric list; when absent, defaults by player type. */
  metrics?: string[];
}

function linesFor(metrics: string[]): Record<string, number> {
  const lines: Record<string, number> = {};
  for (const m of metrics) {
    const prop = getProp(m);
    if (prop) lines[m] = prop.defaultLine;
  }
  return lines;
}

/** Resolve one followed player id into a workflow request (identity + metrics). */
async function resolveRequest(input: FollowedPlayerInput): Promise<FollowedPlayerRequest> {
  const person = await getPlayer(input.playerId).catch(() => null);
  const isPitcher = person?.primaryPosition?.abbreviation === "P";
  const metrics = input.metrics?.length ? input.metrics : isPitcher ? PITCHER_METRICS : BATTER_METRICS;
  return {
    playerId: input.playerId,
    displayName: person?.fullName,
    team: person?.currentTeam?.name,
    position: person?.primaryPosition?.abbreviation,
    metrics,
    lines: linesFor(metrics),
  };
}

/**
 * Build the followed-players performance dashboard. Player identity resolution
 * is bounded (Promise.all over the follow list, which is user-sized), and the
 * per-player game-log fan-out inside the workflow is concurrency-bounded.
 */
export async function buildFollowedPerformance(
  players: FollowedPlayerInput[],
  opts: { concurrency?: number } = {},
): Promise<FollowedPlayersDashboard> {
  if (players.length === 0) {
    return { cards: [], totalFollowed: 0, withData: 0, computedAt: new Date().toISOString() };
  }
  const requests = await Promise.all(players.map(resolveRequest));
  const { result } = await runFollowedPerformanceWorkflow(requests, mlbFollowedPerformanceAdapter, {
    concurrency: opts.concurrency ?? 4,
  });
  if (!result.ok) {
    // Transparent empty dashboard — never fabricated cards.
    return { cards: [], totalFollowed: players.length, withData: 0, computedAt: new Date().toISOString() };
  }
  return result.value;
}
