import { describe, it, expect } from "bun:test";
import { runTennisAcquisitionWorkflow } from "./workflow";
import type { TennisDataProvider, ProviderStatus } from "@/lib/tennis/providers/types";
import type { TennisMatch } from "@/lib/tennis/domain";

function m(over: Partial<TennisMatch> = {}): TennisMatch {
  return {
    id: "m1", tournamentId: "t", season: 2026, surface: "hard", environment: "unknown",
    format: "best_of_3", round: "r32", state: "scheduled", startTime: "2026-08-08T13:00:00Z",
    home: { playerId: "p:1", playerName: "Carlos Alcaraz", side: "home" },
    away: { playerId: "p:2", playerName: "Jannik Sinner", side: "away" },
    sets: [], stats: [], externalIds: {}, sources: ["prov"], ...over,
  };
}

function mockProvider(name: string, status: ProviderStatus, schedule: TennisMatch[]): TennisDataProvider {
  return {
    name,
    capabilities: { schedule: true, results: true, rankings: true, players: true, historical: false },
    status: () => status,
    async getSchedule() { return schedule; },
    async getMatchResults() { return []; },
    async getRankings() { return []; },
    async getPlayer() { return null; },
    async getTournaments() { return []; },
  };
}

describe("tennis-data-acquisition@1", () => {
  it("acquires from a ready provider and returns ok with a full trace", async () => {
    const providers = [mockProvider("sportradar", "ready", [m()])];
    const { result, trace } = await runTennisAcquisitionWorkflow({ dateIso: "2026-08-08" }, { providers });
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.value.status).toBe("ok");
      expect(result.value.matches.length).toBe(1);
      expect(result.value.contributingProviders).toEqual(["sportradar"]);
    }
    // trace contains every executed node, incl. the independent verifier.
    const ids = trace.nodes.map((n) => n.id);
    expect(ids).toContain("independentVerify");
    expect(ids).toContain("reconcile");
    expect(ids).toContain("finalResult");
  });

  it("skips an unconfigured primary and uses the ready secondary (failover)", async () => {
    const providers = [
      mockProvider("sportradar", "unconfigured", []),
      mockProvider("api-tennis", "ready", [m()]),
    ];
    const { result, trace } = await runTennisAcquisitionWorkflow({ dateIso: "2026-08-08" }, { providers });
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.value.status).toBe("ok");
      expect(result.value.contributingProviders).toEqual(["api-tennis"]);
      expect(result.value.providerSelection.map((s) => s.provider)).toEqual(["api-tennis"]);
    }
    // the unconfigured provider's fetch node runs but contributes nothing
    // (short-circuited without a network call), so the fan-in still completes.
    const srFetch = trace.nodes.find((n) => n.id === "fetch:sportradar");
    expect(srFetch?.status).toBe("ok");
    expect(srFetch?.apiCalls ?? 0).toBe(0);
  });

  it("returns DATA_UNAVAILABLE when no provider is routable", async () => {
    const providers = [mockProvider("sportradar", "unconfigured", []), mockProvider("api-tennis", "error", [])];
    const { result } = await runTennisAcquisitionWorkflow({ dateIso: "2026-08-08" }, { providers });
    expect(result.ok).toBe(true);
    if (result.ok) expect(result.value.status).toBe("data_unavailable");
  });

  it("surfaces a cross-provider discrepancy without majority-voting a value", async () => {
    const providers = [
      mockProvider("sportradar", "ready", [m({ startTime: "2026-08-08T13:00:00Z" })]),
      mockProvider("api-tennis", "ready", [m({ id: "at:1", startTime: "2026-08-08T14:30:00Z" })]),
    ];
    const { result } = await runTennisAcquisitionWorkflow({ dateIso: "2026-08-08" }, { providers });
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.value.status).toBe("degraded");
      const d = result.value.discrepancies.find((x) => x.field === "startTime");
      expect(d).toBeDefined();
      expect(Object.keys(d!.values).sort()).toEqual(["api-tennis", "sportradar"]);
    }
  });

  it("excludes rejected data from the output (player-vs-self never reaches output)", async () => {
    const bad = m({ state: "completed", home: { playerId: "p:9", playerName: "X", side: "home", isWinner: true }, away: { playerId: "p:9", playerName: "X", side: "away" }, sets: [{ homeGames: 6, awayGames: 0 }] });
    const providers = [mockProvider("sportradar", "ready", [bad])];
    const { result } = await runTennisAcquisitionWorkflow({ dateIso: "2026-08-08" }, { providers });
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.value.matches.length).toBe(0);
      expect(result.value.verification.verdict).toBe("REJECT");
      expect(result.value.status).toBe("data_unavailable");
    }
  });

  it("respects cancellation via an aborted signal", async () => {
    const providers = [mockProvider("sportradar", "ready", [m()])];
    const controller = new AbortController();
    controller.abort();
    const { result } = await runTennisAcquisitionWorkflow({ dateIso: "2026-08-08" }, { providers }, { signal: controller.signal });
    expect(result.ok).toBe(false);
  });
});
