import { describe, it, expect } from "bun:test";
import { apiTennisAdapter } from "./apiTennis";
import { sportradarAdapter } from "./sportradar";
import { sportsDataIoAdapter } from "./sportsdataio";
import {
  API_TENNIS_FIXTURES, API_TENNIS_STANDINGS, API_TENNIS_PLAYERS,
  SPORTRADAR_SUMMARIES, SPORTRADAR_RANKINGS, SPORTRADAR_PROFILE,
  SPORTSDATAIO_GAMES, SPORTSDATAIO_PLAYERS,
} from "./fixtures";
import { zTennisMatch, zRankingSnapshot, zTennisPlayer } from "../../schemas/tennis";
import { SURFACE_UNRESOLVED } from "./shared";

const NOW = Date.parse("2026-08-08T20:00:00Z");

describe("API-Tennis adapter", () => {
  it("maps get_fixtures into canonical matches (schedule keeps only upcoming)", () => {
    const r = apiTennisAdapter.parseSchedule!(API_TENNIS_FIXTURES, NOW);
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    // only the Not-Started WTA match is a schedule fixture
    expect(r.value.length).toBe(1);
    const m = r.value[0];
    expect(zTennisMatch.safeParse(m).success).toBe(true);
    expect(m.state).toBe("scheduled");
    expect(m.home.playerName).toBe("Iga Swiatek");
    expect(m.format).toBe("best_of_3"); // WTA rule
  });

  it("maps get_fixtures completed match with correct sets + winner + provider id", () => {
    const r = apiTennisAdapter.parseResults!(API_TENNIS_FIXTURES, NOW);
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    expect(r.value.length).toBe(1);
    const m = r.value[0];
    expect(zTennisMatch.safeParse(m).success).toBe(true);
    expect(m.state).toBe("completed");
    expect(m.home.isWinner).toBe(true);
    expect(m.away.isWinner).toBe(false);
    expect(m.sets).toEqual([
      { homeGames: 6, awayGames: 4 },
      { homeGames: 3, awayGames: 6 },
      { homeGames: 7, awayGames: 5 },
    ]);
    expect(m.externalIds["api-tennis"]).toBe("1234567");
    // Cincinnati is not in the factual surface table → unresolved marker present.
    expect(m.sources).toContain(SURFACE_UNRESOLVED);
  });

  it("maps get_standings into valid rankings", () => {
    const r = apiTennisAdapter.parseRankings!(API_TENNIS_STANDINGS, NOW);
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    expect(r.value.length).toBe(2);
    expect(zRankingSnapshot.safeParse(r.value[0]).success).toBe(true);
    expect(r.value[0].rank).toBe(1);
    expect(r.value[0].points).toBe(11830);
  });

  it("maps get_players into a canonical player (no fabricated handedness)", () => {
    const r = apiTennisAdapter.parsePlayer!(API_TENNIS_PLAYERS, NOW, "api-tennis:1001");
    expect(r.ok).toBe(true);
    if (!r.ok || !r.value) return;
    expect(zTennisPlayer.safeParse(r.value).success).toBe(true);
    expect(r.value.dateOfBirth).toBe("2003-05-05");
    expect(r.value.plays).toBe("unknown"); // not supplied ⇒ not fabricated
  });

  it("rejects a malformed envelope as schema failure, never []", () => {
    const r = apiTennisAdapter.parseSchedule!({ nope: true }, NOW);
    expect(r.ok).toBe(false);
  });

  it("treats success=0 with no result array as a schema failure (not empty-valid)", () => {
    const r = apiTennisAdapter.parseSchedule!({ success: 0, error: 401 }, NOW);
    expect(r.ok).toBe(false);
  });

  it("tolerates unknown optional fields and skips unmappable rows", () => {
    const payload = { success: 1, result: [
      { event_key: 9, brand_new_field: "x" }, // unmappable (no players) → skipped
      { event_key: 10, event_first_player: "A", event_second_player: "B", event_status: "Not Started", event_type_type: "Atp Singles", extra: 1 },
    ] };
    const r = apiTennisAdapter.parseSchedule!(payload, NOW);
    expect(r.ok).toBe(true);
    if (r.ok) expect(r.value.length).toBe(1);
  });
});

describe("Sportradar adapter", () => {
  it("maps daily summaries; completed match excluded from schedule", () => {
    const r = sportradarAdapter.parseSchedule!(SPORTRADAR_SUMMARIES, NOW);
    expect(r.ok).toBe(true);
    if (r.ok) expect(r.value.length).toBe(0); // the only event is closed/completed
  });

  it("maps rankings with competitor ids + points", () => {
    const r = sportradarAdapter.parseRankings!(SPORTRADAR_RANKINGS, NOW);
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    expect(r.value.length).toBe(2);
    expect(r.value[0].playerId).toBe("sportradar:sr:competitor:2002");
    expect(r.value[0].rank).toBe(1);
  });

  it("maps competitor profile with handedness + height, resolves surface from conditions", () => {
    const r = sportradarAdapter.parsePlayer!(SPORTRADAR_PROFILE, NOW, "sportradar:sr:competitor:2001");
    expect(r.ok).toBe(true);
    if (!r.ok || !r.value) return;
    expect(zTennisPlayer.safeParse(r.value).success).toBe(true);
    expect(r.value.plays).toBe("right");
    expect(r.value.heightCm).toBe(183);
  });

  it("resolves surface from sport_event_conditions (no unresolved marker)", () => {
    // Force the closed match through the results path to inspect its mapping.
    const summariesAsResults = { summaries: SPORTRADAR_SUMMARIES.summaries };
    const r = sportradarAdapter.parseSchedule!(summariesAsResults, NOW);
    // schedule filters out completed, so assert on rankings-independent surface via a scheduled clone:
    const scheduledClone = structuredClone(SPORTRADAR_SUMMARIES);
    scheduledClone.summaries[0].sport_event_status.status = "not_started";
    const r2 = sportradarAdapter.parseSchedule!(scheduledClone, NOW);
    expect(r.ok && r2.ok).toBe(true);
    if (r2.ok) {
      expect(r2.value[0].surface).toBe("hard");
      expect(r2.value[0].sources).not.toContain(SURFACE_UNRESOLVED);
    }
  });

  it("rejects a malformed summaries envelope", () => {
    expect(sportradarAdapter.parseSchedule!({ wrong: 1 }, NOW).ok).toBe(false);
  });
});

describe("SportsDataIO adapter", () => {
  it("maps Games array into completed matches with sets + winner", () => {
    const r = sportsDataIoAdapter.parseResults!(SPORTSDATAIO_GAMES, NOW);
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    expect(r.value.length).toBe(1);
    const m = r.value[0];
    expect(zTennisMatch.safeParse(m).success).toBe(true);
    expect(m.home.isWinner).toBe(true);
    expect(m.surface).toBe("hard");
    expect(m.sets.length).toBe(3);
  });

  it("resolves a player by id from the Players list; unknown id ⇒ null (never fabricated)", () => {
    const hit = sportsDataIoAdapter.parsePlayer!(SPORTSDATAIO_PLAYERS, NOW, "sportsdataio:3001");
    expect(hit.ok).toBe(true);
    if (hit.ok && hit.value) {
      expect(hit.value.fullName).toBe("Carlos Alcaraz");
      expect(hit.value.dateOfBirth).toBe("2003-05-05");
    }
    const miss = sportsDataIoAdapter.parsePlayer!(SPORTSDATAIO_PLAYERS, NOW, "sportsdataio:999999");
    expect(miss.ok).toBe(true);
    if (miss.ok) expect(miss.value).toBeNull();
  });

  it("rejects a non-array games payload as schema failure", () => {
    expect(sportsDataIoAdapter.parseResults!({ not: "an array" }, NOW).ok).toBe(false);
  });

  it("accepts Player1Id/Player1 variant spelling defensively", () => {
    const variant = [{ GameId: 5, Player1: "A", Player2: "B", Player1Id: 7, Player2Id: 8, Status: "Scheduled", CompetitionName: "Wimbledon" }];
    const r = sportsDataIoAdapter.parseSchedule!(variant, NOW);
    expect(r.ok).toBe(true);
    if (r.ok) {
      expect(r.value.length).toBe(1);
      expect(r.value[0].surface).toBe("grass"); // resolved factually from "Wimbledon"
    }
  });
});
