import { describe, it, expect } from "bun:test";
import { matchToObservation, rankingToObservation, isUsableForCutoff, stableHash } from "./observations";
import type { TennisMatch, RankingSnapshot } from "../domain";
import { makeProvenance } from "../providers/http";

const match: TennisMatch = {
  id: "sportradar:sr:sport_event:1", tournamentId: "t", season: 2026, surface: "hard",
  environment: "unknown", format: "best_of_3", round: "final", state: "scheduled",
  startTime: "2026-08-10T13:00:00Z",
  home: { playerId: "p:1", playerName: "A", side: "home" },
  away: { playerId: "p:2", playerName: "B", side: "away" },
  sets: [], stats: [], externalIds: { sportradar: "sr:sport_event:1" }, sources: ["sportradar"],
};

describe("tennis raw-observation mapping (sport via entity_type)", () => {
  it("encodes sport=tennis without a schema change and preserves provenance", () => {
    const prov = makeProvenance({ provider: "sportradar", providerRecordId: "sr:sport_event:1", now: Date.parse("2026-08-08T00:00:00Z") });
    const obs = matchToObservation(match, prov);
    expect(obs.entity_type).toBe("tennis_match");
    expect(obs.source).toBe("sportradar");
    expect(obs.observation_type).toBe("tennis_schedule");
    expect(obs.source_record_id).toBe("sr:sport_event:1");
    expect(obs.event_time).toBe("2026-08-10T13:00:00Z");
    // available_at >= effective_at (DB constraint) — knowable at capture, event is future.
    expect(Date.parse(obs.available_at) >= Date.parse(obs.effective_at)).toBe(true);
    expect(obs.payload_hash).toBe(stableHash(match));
    expect(obs.schema_version).toBe("tennis-1");
  });

  it("marks completed matches as tennis_result", () => {
    const prov = makeProvenance({ provider: "api-tennis", now: Date.parse("2026-08-11T00:00:00Z") });
    const obs = matchToObservation({ ...match, state: "completed" }, prov);
    expect(obs.observation_type).toBe("tennis_result");
  });

  it("gates a future fixture out of a pre-event feature cutoff (no leakage)", () => {
    // Captured 2026-08-09 but used with a cutoff of 2026-08-08 → not usable.
    const prov = makeProvenance({ provider: "sportradar", now: Date.parse("2026-08-09T00:00:00Z") });
    const obs = matchToObservation(match, prov);
    expect(isUsableForCutoff(obs, "2026-08-08T00:00:00Z")).toBe(false);
    expect(isUsableForCutoff(obs, "2026-08-09T12:00:00Z")).toBe(true);
  });

  it("rankings become knowable at publication (asOf), gating future rankings", () => {
    const rank: RankingSnapshot = { playerId: "p:1", tour: "atp", asOf: "2026-08-11", rank: 1, points: 11000 };
    const prov = makeProvenance({ provider: "api-tennis", now: Date.parse("2026-08-11T00:00:00Z") });
    const obs = rankingToObservation(rank, prov);
    expect(obs.entity_type).toBe("tennis_ranking");
    expect(isUsableForCutoff(obs, "2026-08-10T00:00:00Z")).toBe(false); // published 08-11, cutoff 08-10
  });
});
