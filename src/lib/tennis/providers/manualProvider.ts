/* ============================================================================
   Manual provider — data a user enters by hand (mirrors the PrizePicks manual
   import discipline). No automation, no scraping: the human supplies matches and
   players, each validated at the boundary before entering the pipeline. Values
   keep their manual provenance and are never presented as a live feed.
   ========================================================================== */

import { safeValidate } from "@/lib/schemas/validate";
import { zTennisMatch, zTennisPlayer } from "../schemas/tennis";
import type {
  RankingSnapshot, TennisMatch, TennisPlayer, TennisTour, Tournament,
} from "../domain";
import { recordSuccess, setStatus } from "./health";
import type {
  HistoricalQuery, ProviderCapabilities, ProviderStatus, ScheduleQuery, TennisDataProvider,
} from "./types";

const NAME = "manual";

const CAPS: ProviderCapabilities = {
  schedule: true, results: true, rankings: false, players: true, historical: false,
};

export interface ManualSeed {
  matches?: TennisMatch[];
  players?: TennisPlayer[];
  tournaments?: Tournament[];
}

export function createManualProvider(seed: ManualSeed = {}): TennisDataProvider {
  const matches = (seed.matches ?? []).map((m) => safeValidate(zTennisMatch, m, m, "manual.match"));
  const players = (seed.players ?? []).map((p) => safeValidate(zTennisPlayer, p, p, "manual.player"));
  const tournaments = seed.tournaments ?? [];

  return {
    name: NAME,
    capabilities: CAPS,
    status(): ProviderStatus {
      const ready = matches.length > 0 || players.length > 0;
      setStatus(NAME, ready ? "ready" : "unconfigured", `${matches.length} manual matches, ${players.length} players`);
      return ready ? "ready" : "unconfigured";
    },
    async getSchedule(query: ScheduleQuery): Promise<TennisMatch[]> {
      const t0 = Date.now();
      const out = matches.filter((m) => m.state === "scheduled")
        .filter((m) => (query.dateIso ? (m.startTime ?? "").startsWith(query.dateIso) || !m.startTime : true));
      recordSuccess(NAME, Date.now() - t0);
      return out;
    },
    async getMatchResults(query: HistoricalQuery): Promise<TennisMatch[]> {
      const t0 = Date.now();
      const out = matches.filter((m) => m.state === "completed" && m.season === query.season);
      recordSuccess(NAME, Date.now() - t0);
      return out;
    },
    async getRankings(_tour: TennisTour): Promise<RankingSnapshot[]> { void _tour; return []; },
    async getPlayer(externalId: string): Promise<TennisPlayer | null> {
      const t0 = Date.now();
      const found = players.find((p) => p.id === externalId || Object.values(p.externalIds).includes(externalId)) ?? null;
      recordSuccess(NAME, Date.now() - t0);
      return found;
    },
    async getTournaments(season: number, tour?: TennisTour): Promise<Tournament[]> {
      return tournaments.filter((t) => t.season === season).filter((t) => (tour ? t.tour === tour : true));
    },
  };
}
