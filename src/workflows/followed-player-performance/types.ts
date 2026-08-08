/* Contracts for followed-player-performance@1. The graph fans out over a user's
   FOLLOWED players (bounded concurrency), fetches each one's per-game prop series
   via an injected provider, and computes a PURELY HISTORICAL performance record
   (`buildMetricPerformance`) per player+metric. Providers are injected so the
   graph runs deterministically offline.

   The workflow computes NO model probabilities — it only summarizes past games.
   A per-player fetch failure degrades that player to `available:false`; it never
   fabricates data and never sinks the whole run. Pure (zod + domain types). */

import { z } from "zod";
import type { PropGameSample } from "@/lib/mlb/series";
import type { PlayerMetricPerformance } from "@/lib/players/performance";

/** One followed player and the metrics the user wants surfaced. */
export interface FollowedPlayerRequest {
  playerId: number; // canonical MLBAM id
  displayName?: string; // cached label only; identity is playerId
  team?: string;
  position?: string;
  /** Prop keys to compute (e.g. ["hits","total_bases"]). */
  metrics: string[];
  /** Optional line per metric for prop-history hit rate (historical only). */
  lines?: Record<string, number>;
}

export const followedPerformanceInputSchema = z.object({
  players: z.custom<FollowedPlayerRequest[]>((v) => Array.isArray(v)),
  /** Max players fetched in parallel. Bounded to keep MLB API load sane. */
  concurrency: z.number().int().positive().max(16).optional(),
});
export type FollowedPerformanceInput = z.infer<typeof followedPerformanceInputSchema>;

/** Per-player card assembled for the My Players dashboard. */
export interface FollowedPlayerCard {
  playerId: number;
  displayName?: string;
  team?: string;
  position?: string;
  /** False when NO metric had any data (transparent, never zero-filled). */
  available: boolean;
  metrics: PlayerMetricPerformance[];
  /** ISO timestamp this card was computed at (provenance / "last updated"). */
  computedAt: string;
  /** Set when the provider failed for this player (degraded, not fabricated). */
  error?: string;
}

export interface FollowedPlayersDashboard {
  cards: FollowedPlayerCard[];
  totalFollowed: number;
  /** Players that returned at least one available metric. */
  withData: number;
  computedAt: string;
}

export interface FollowedPerformanceDeps {
  /**
   * Fetch a player's oldest→newest per-game series for one prop metric. Throwing
   * (or returning []) degrades that metric to unavailable — never fabricated.
   */
  getSeries(args: { playerId: number; metric: string }): Promise<PropGameSample[]>;
  /** Injectable clock for deterministic tests. */
  now?(): string;
}
