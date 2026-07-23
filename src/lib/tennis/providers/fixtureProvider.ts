/* ============================================================================
   Fixture provider — serves the TEST-ONLY sample corpus so the acquisition +
   validation + simulation pipeline can be exercised end-to-end without any live
   credentials. Its status is permanently "fixture", and the acquisition layer
   refuses fixture providers when asked for a production data path (audit §5).
   ========================================================================== */

import { safeValidate } from "@/lib/schemas/validate";
import { zTennisMatch, zTennisPlayer } from "../schemas/tennis";
import type { RankingSnapshot, TennisMatch, TennisPlayer, TennisTour, Tournament } from "../domain";
import {
  FIXTURE_MATCHES, FIXTURE_PLAYERS, FIXTURE_RANKINGS, FIXTURE_TOURNAMENTS,
} from "../fixtures/sample";
import { recordSuccess, setStatus } from "./health";
import type {
  HistoricalQuery, ProviderCapabilities, ProviderStatus, ScheduleQuery, TennisDataProvider,
} from "./types";

const NAME = "fixture";

const CAPS: ProviderCapabilities = {
  schedule: true, results: true, rankings: true, players: true, historical: true,
};

export const fixtureProvider: TennisDataProvider = {
  name: NAME,
  capabilities: CAPS,
  status(): ProviderStatus {
    setStatus(NAME, "fixture", "Test-only sample corpus. Never a production source.");
    return "fixture";
  },

  async getSchedule(query: ScheduleQuery): Promise<TennisMatch[]> {
    const t0 = Date.now();
    // Validate each fixture at the boundary exactly as a live provider would.
    const scheduled = FIXTURE_MATCHES
      .filter((m) => m.state === "scheduled")
      .filter((m) => (query.tour ? sideTour(m) === query.tour : true))
      .map((m) => safeValidate(zTennisMatch, m, m, "fixture.schedule"));
    recordSuccess(NAME, Date.now() - t0);
    return scheduled;
  },

  async getMatchResults(query: HistoricalQuery): Promise<TennisMatch[]> {
    const t0 = Date.now();
    const results = FIXTURE_MATCHES
      .filter((m) => m.state === "completed" && m.season === query.season)
      .filter((m) => (query.surface ? m.surface === query.surface : true))
      .map((m) => safeValidate(zTennisMatch, m, m, "fixture.results"));
    recordSuccess(NAME, Date.now() - t0);
    return results;
  },

  async getRankings(tour: TennisTour): Promise<RankingSnapshot[]> {
    const t0 = Date.now();
    const out = FIXTURE_RANKINGS.filter((r) => r.tour === tour);
    recordSuccess(NAME, Date.now() - t0);
    return out;
  },

  async getPlayer(externalId: string): Promise<TennisPlayer | null> {
    const t0 = Date.now();
    const found = FIXTURE_PLAYERS.find(
      (p) => p.externalIds.fixture === externalId || p.id === externalId,
    );
    recordSuccess(NAME, Date.now() - t0);
    return found ? safeValidate(zTennisPlayer, found, found, "fixture.player") : null;
  },

  async getTournaments(season: number, tour?: TennisTour): Promise<Tournament[]> {
    const t0 = Date.now();
    const out = FIXTURE_TOURNAMENTS
      .filter((t) => t.season === season)
      .filter((t) => (tour ? t.tour === tour : true));
    recordSuccess(NAME, Date.now() - t0);
    return out;
  },
};

/** Derive the tour a match belongs to from its home player's tour, via fixtures. */
function sideTour(m: TennisMatch): TennisTour | undefined {
  return FIXTURE_PLAYERS.find((p) => p.id === m.home.playerId)?.tour;
}
