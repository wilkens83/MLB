import { describe, it, expect } from "bun:test";
import { runFreeDataWorkflow } from "./workflow";
import { buildFreeDataset, type FreeDataset } from "@/lib/tennis/data/freeDataset";

describe("tennis-free-data-acquisition@1", () => {
  it("runs the full graph offline and produces a health report", async () => {
    const { result, trace } = await runFreeDataWorkflow({ featureCutoff: "2025-01-01" });
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(["ok", "degraded"]).toContain(result.value.status);
      expect(result.value.verification.verdict).toBe("PASS");
      expect(result.value.observationsPersisted).toBeGreaterThan(0);
      expect(result.value.licenseUse).toBe("research/non-commercial");
      expect(result.value.coverage.atpMatches).toBeGreaterThan(0);
    }
    const ids = trace.nodes.map((n) => n.id);
    for (const id of ["datasetMetadata", "loadSource", "normalize", "resolveIdentities", "verifyCanonicalData", "persist", "healthReport"]) {
      expect(ids).toContain(id);
    }
  });

  it("does NOT persist when verification REJECTs (rejected data never persisted)", async () => {
    // Inject a dataset with a player-vs-self match ⇒ REJECT.
    const base = buildFreeDataset();
    const bad: FreeDataset = {
      ...base,
      matches: [{
        ...base.matches[0],
        id: "atp:bad", state: "completed",
        home: { playerId: "csv:1", playerName: "X", side: "home", isWinner: true },
        away: { playerId: "csv:1", playerName: "X", side: "away" },
        sets: [{ homeGames: 6, awayGames: 0 }],
      }],
    };
    const { result, trace } = await runFreeDataWorkflow({}, { load: () => bad });
    const persist = trace.nodes.find((n) => n.id === "persist");
    expect(persist?.status).toBe("skipped");
    if (result.ok) {
      expect(result.value.status).toBe("failed");
      expect(result.value.observationsPersisted).toBe(0);
    }
  });

  it("flags a future ranking as leakage against the feature cutoff", async () => {
    const { result } = await runFreeDataWorkflow({ featureCutoff: "2024-06-15" });
    // Rankings dated 2024-09-09 are after the cutoff ⇒ REJECT-level leakage.
    if (result.ok) {
      expect(result.value.verification.rankingsVerdict).toBe("REJECT");
      expect(result.value.verification.issues.some((i) => i.code === "FUTURE_RANKING")).toBe(true);
    }
  });
});
