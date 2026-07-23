/* ============================================================================
   HistoricalStore abstraction. The tennis spec assumes a database for the
   historical corpus; this repo has none (audit §5). Rather than smuggle a DB in,
   the acquisition layer targets THIS interface, with an in-memory implementation
   now and a file/DB-backed implementation later — a one-class swap.
   ========================================================================== */

import type { TennisMatch, TennisTour } from "../domain";

export interface HistoricalStore {
  /** Persist (upsert by match id) a batch of completed matches. */
  upsertMatches(matches: TennisMatch[]): Promise<number>;
  /** All stored matches for a season/tour, optionally filtered by surface. */
  getMatches(query: { season?: number; tour?: TennisTour; surface?: string }): Promise<TennisMatch[]>;
  /** Every completed match a player appears in (either side). */
  getPlayerMatches(playerId: string): Promise<TennisMatch[]>;
  count(): Promise<number>;
}

/**
 * In-memory store — ephemeral, process-local. Sufficient for backtests within a
 * single run and for tests; a durable store replaces it without touching callers.
 */
export class InMemoryHistoricalStore implements HistoricalStore {
  private byId = new Map<string, TennisMatch>();

  async upsertMatches(matches: TennisMatch[]): Promise<number> {
    let n = 0;
    for (const m of matches) { this.byId.set(m.id, m); n++; }
    return n;
  }

  async getMatches(query: { season?: number; tour?: TennisTour; surface?: string }): Promise<TennisMatch[]> {
    return [...this.byId.values()].filter((m) => {
      if (query.season !== undefined && m.season !== query.season) return false;
      if (query.surface && m.surface !== query.surface) return false;
      return true;
    });
  }

  async getPlayerMatches(playerId: string): Promise<TennisMatch[]> {
    return [...this.byId.values()].filter(
      (m) => m.home.playerId === playerId || m.away.playerId === playerId,
    );
  }

  async count(): Promise<number> {
    return this.byId.size;
  }
}
