/* ============================================================================
   Tennis provider registry with failover. The acquisition layer asks the
   registry for data; the registry tries providers in priority order and returns
   the first non-empty, ready result. Fixture providers are excluded from
   production paths unless explicitly allowed (test/dev), so live code never
   accidentally serves test fixtures (audit §5).

   Priority (highest first) for production: live credentialed providers →
   historical CSV → manual. The fixture provider sits OUTSIDE this order and is
   only used when `allowFixtures` is set.
   ========================================================================== */

import type {
  HistoricalQuery, ScheduleQuery, TennisDataProvider, TennisProviderHealth,
} from "./types";
import type { RankingSnapshot, TennisPlayer, TennisTour, Tournament } from "../domain";
import { getAllTennisHealth } from "./health";

export interface RegistryOptions {
  /** Providers in priority order (first = tried first). */
  providers: TennisDataProvider[];
  /**
   * Permit fixture-status providers to satisfy requests. MUST be false in any
   * production data path; true only in tests/dev.
   */
  allowFixtures?: boolean;
}

export class TennisProviderRegistry {
  private readonly providers: TennisDataProvider[];
  private readonly allowFixtures: boolean;

  constructor(opts: RegistryOptions) {
    this.providers = opts.providers;
    this.allowFixtures = opts.allowFixtures ?? false;
  }

  /** Providers eligible to serve, respecting the fixture policy. */
  private eligible(capability: keyof TennisDataProvider["capabilities"]): TennisDataProvider[] {
    return this.providers.filter((p) => {
      if (!p.capabilities[capability]) return false;
      const s = p.status();
      if (s === "fixture") return this.allowFixtures;
      return s === "ready";
    });
  }

  /** Try each eligible provider until one returns a non-empty array. */
  private async failoverList<T>(
    capability: keyof TennisDataProvider["capabilities"],
    call: (p: TennisDataProvider) => Promise<T[]>,
  ): Promise<{ data: T[]; provider?: string }> {
    for (const p of this.eligible(capability)) {
      try {
        const data = await call(p);
        if (data.length > 0) return { data, provider: p.name };
      } catch {
        // provider threw unexpectedly — move on (it should degrade, not throw)
      }
    }
    return { data: [] };
  }

  async getSchedule(query: ScheduleQuery) {
    return this.failoverList("schedule", (p) => p.getSchedule(query));
  }

  async getMatchResults(query: HistoricalQuery) {
    return this.failoverList("results", (p) => p.getMatchResults(query));
  }

  async getRankings(tour: TennisTour, asOf?: string) {
    return this.failoverList("rankings", (p) => p.getRankings(tour, asOf));
  }

  async getTournaments(season: number, tour?: TennisTour): Promise<Tournament[]> {
    const { data } = await this.failoverList("schedule", (p) => p.getTournaments(season, tour));
    return data;
  }

  /** First provider that resolves a non-null player wins. */
  async getPlayer(externalId: string): Promise<{ player: TennisPlayer | null; provider?: string }> {
    for (const p of this.eligible("players")) {
      try {
        const player = await p.getPlayer(externalId);
        if (player) return { player, provider: p.name };
      } catch {
        /* degrade */
      }
    }
    return { player: null };
  }

  /** Combine rankings across all eligible providers (union, dedup by playerId). */
  async getAllRankings(tour: TennisTour, asOf?: string): Promise<RankingSnapshot[]> {
    const seen = new Map<string, RankingSnapshot>();
    for (const p of this.eligible("rankings")) {
      try {
        for (const r of await p.getRankings(tour, asOf)) {
          if (!seen.has(r.playerId)) seen.set(r.playerId, r);
        }
      } catch {
        /* degrade */
      }
    }
    return [...seen.values()];
  }

  /** Snapshot of provider readiness for the health surface. */
  health(): TennisProviderHealth[] {
    // Touch status() so each provider reflects current readiness.
    for (const p of this.providers) p.status();
    return getAllTennisHealth();
  }

  providerNames(): string[] {
    return this.providers.map((p) => p.name);
  }
}
