/* ============================================================================
   Tennis data acquisition facade — the single orchestrator the engine/UI calls.
   It ties together the provider registry (with failover), the historical store,
   identity reconciliation, and per-market series derivation. This is the tennis
   analogue of `src/lib/mlb/analysis.ts`, but for the ACQUISITION half only —
   projection/simulation come in later phases.

   Three acquisition modes (audit §9):
     - live:       upcoming fixtures for a date (schedule capability)
     - historical: backfill completed matches into the store (idempotent)
     - projection: assemble a player's derived series for a market from history
   ========================================================================== */

import type {
  RankingSnapshot, TennisMatch, TennisMatchSample, TennisMarketKey, TennisTour,
} from "../domain";
import type { TennisProviderRegistry } from "../providers/registry";
import { derivePlayerSeries, estimateServeReturn } from "./derive";
import type { HistoricalStore } from "./store";
import { InMemoryHistoricalStore } from "./store";
import { reconcilePlayers } from "./identity";

export interface AcquisitionDeps {
  registry: TennisProviderRegistry;
  store?: HistoricalStore;
}

export interface ScheduleResult {
  date: string;
  matches: TennisMatch[];
  provider?: string;
}

export interface BackfillResult {
  season: number;
  tour: TennisTour;
  fetched: number;
  stored: number;
  provider?: string;
}

export interface PlayerFormResult {
  playerId: string;
  market: TennisMarketKey;
  samples: TennisMatchSample[];
  series: number[];
  sampleSize: number;
  serveReturn: ReturnType<typeof estimateServeReturn>;
}

export class TennisAcquisition {
  private readonly registry: TennisProviderRegistry;
  private readonly store: HistoricalStore;

  constructor(deps: AcquisitionDeps) {
    this.registry = deps.registry;
    this.store = deps.store ?? new InMemoryHistoricalStore();
  }

  /** LIVE: upcoming fixtures for a date (with provider failover). */
  async getSchedule(dateIso: string, tour?: TennisTour): Promise<ScheduleResult> {
    const { data, provider } = await this.registry.getSchedule({ dateIso, tour });
    return { date: dateIso, matches: data, provider };
  }

  /**
   * HISTORICAL: fetch completed matches for a season/tour and upsert into the
   * store. Idempotent — re-running upserts by id, so it is safe to re-run
   * (audit §5: acquisition exposed as idempotent operations, not a scheduler).
   */
  async backfillSeason(tour: TennisTour, season: number, surface?: string): Promise<BackfillResult> {
    const { data, provider } = await this.registry.getMatchResults({ tour, season, surface });
    const stored = await this.store.upsertMatches(data);
    return { season, tour, fetched: data.length, stored, provider };
  }

  /**
   * PROJECTION INPUT: assemble a player's derived per-market series from stored
   * history, plus serve/return estimates for the structural simulator. This is
   * the hand-off point to the (later) tennis projection + simulation phases.
   */
  async getPlayerForm(playerId: string, market: TennisMarketKey): Promise<PlayerFormResult> {
    const matches = await this.store.getPlayerMatches(playerId);
    const samples = derivePlayerSeries(matches, playerId, market);
    return {
      playerId,
      market,
      samples,
      series: samples.map((s) => s.value),
      sampleSize: samples.length,
      serveReturn: estimateServeReturn(matches, playerId),
    };
  }

  /** Rankings snapshot for a tour, unioned across providers. */
  async getRankings(tour: TennisTour, asOf?: string): Promise<RankingSnapshot[]> {
    return this.registry.getAllRankings(tour, asOf);
  }

  /**
   * Reconcile players discovered from a list of external ids into a canonical,
   * deduplicated set (never joining by name alone).
   */
  async resolvePlayers(externalIds: string[]): Promise<ReturnType<typeof reconcilePlayers>> {
    const discovered = [];
    for (const id of externalIds) {
      const { player } = await this.registry.getPlayer(id);
      if (player) discovered.push(player);
    }
    return reconcilePlayers(discovered);
  }

  store_(): HistoricalStore {
    return this.store;
  }
}
