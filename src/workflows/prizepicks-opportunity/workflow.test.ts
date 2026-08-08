import { describe, it, expect } from "bun:test";
import { runOpportunityWorkflow } from "./workflow";
import type { OpportunityDeps } from "./types";
import { InMemoryOpportunityStore } from "@/lib/prizepicks/opportunity/store";
import { unavailableCalibration, type CalibrationModel } from "@/lib/prizepicks/opportunity/calibration";
import { lineEntryId, lineInputHash, type CanonicalLineSnapshot } from "@/lib/prizepicks/ingestion/snapshot";

const shrink: CalibrationModel = { available: true, version: "cal-1", sampleSize: 500, apply: (r) => r * 0.9 };

function verifiedLine(): CanonicalLineSnapshot {
  const boardDate = "2026-07-21", player = "paul skenes", market = "strikeouts", line = 5.5;
  return {
    entryId: lineEntryId(boardDate, player, market), boardDate, playerName: player, rawPlayerName: "Paul Skenes",
    playerId: 694973, gamePk: 776001, marketKey: market, rawMarketLabel: "Pitcher Strikeouts",
    marketSupported: true, line, projectionType: "standard", capturedAt: "2026-07-21T20:00:00Z",
    source: "csv", verificationStatus: "VERIFIED",
    inputHash: lineInputHash({ boardDate, normalizedPlayerName: player, marketKey: market, line, projectionType: "standard" }),
  };
}

function deps(store: InMemoryOpportunityStore, cal: CalibrationModel = shrink): OpportunityDeps {
  return {
    async loadPregame() {
      return { pregameSnapshotExists: true, snapshotBeforeEvent: true, featureCutoffBeforeStart: true, gameStarted: false };
    },
    async getProjection() {
      return {
        isPitcher: true, rawProbabilityMore: 0.75, rawProbabilityLess: 0.24, rawProbabilityPush: 0.01,
        projectionMean: 6.3, projectionMedian: 6, dataQuality: 90, volatility: 20, uncertaintyLow: 0.62, uncertaintyHigh: 0.82,
      };
    },
    async getSensitivity() { return { fragility: 20, worstCaseSelectedProbability: 0.66 }; },
    async getCalibration() { return cal; },
    async getScientificFacts() {
      return {
        marketValidationState: "VALIDATED", calibrationDegraded: false, featureDriftExceeded: false,
        outsideTrainingSupport: false, requiredSimDependencyUnavailable: false, trainingSupport: 1,
        playerResolved: true, gameResolved: true, marketSupported: true,
        lineupRequired: false, lineupConfirmed: false, pitcherMateriallyRelevant: true, starterConfirmed: true,
        lineAgeMinutes: 5, modelVersionApproved: true, modelVersion: "mlb-model-9", featureVersion: "feat-3",
      };
    },
    store,
  };
}

describe("prizepicks-opportunity@1", () => {
  it("runs the full graph, QUALIFIES, and persists the assessment", async () => {
    const store = new InMemoryOpportunityStore();
    const { result, trace } = await runOpportunityWorkflow(verifiedLine(), deps(store));
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.value.status).toBe("QUALIFIED_MORE");
      expect(result.value.calibrationAvailable).toBe(true);
      expect(result.value.modelAdvantage!).toBeGreaterThan(0);
      expect(result.value.modelVersion).toBe("mlb-model-9");
      expect(result.value.calibrationVersion).toBe("cal-1");
    }
    for (const id of [
      "resolveLine", "loadPregameSnapshot", "projection", "independentBaseline", "calibration",
      "uncertainty", "sensitivity", "fragility", "trustedScientificFacts", "vetoes", "opportunityDecision",
    ]) {
      expect(trace.nodes.map((n) => n.id)).toContain(id);
    }
    // persisted, referencing the exact line snapshot
    const hist = await store.history(verifiedLine().entryId);
    expect(hist.length).toBe(1);
    expect(hist[0].assessment.lineSnapshotId).toBe(verifiedLine().entryId);
  });

  it("degrades to WATCH when calibration is unavailable (never QUALIFIED)", async () => {
    const store = new InMemoryOpportunityStore();
    const { result } = await runOpportunityWorkflow(verifiedLine(), deps(store, unavailableCalibration()));
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.value.status).toBe("WATCH");
      expect(result.value.calibratedProbabilityMore).toBeUndefined();
      expect(result.value.reasonCodes).toContain("CALIBRATION_UNAVAILABLE");
    }
  });
});
