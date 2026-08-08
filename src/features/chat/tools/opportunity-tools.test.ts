import { describe, it, expect, afterEach } from "bun:test";
import { getOpportunitiesTool } from "./prizepicks/get-opportunities";
import { getScientificMetricsTool, __setChatHealthSource, __resetChatHealthSource } from "./prizepicks/get-scientific-metrics";
import { __setOpportunitySource, __resetOpportunitySource } from "@/lib/prizepicks/opportunity/shared-store";
import type { CanonicalOpportunityAssessment } from "@/lib/prizepicks/opportunity/types";
import type { ChatToolContext } from "./types";
import type { ScientificRawData } from "@/lib/supabase/scientific-health";
import { PERSISTENCE_TABLES } from "@/lib/supabase/scientific-health";

const ctx: ChatToolContext = { date: "2026-07-21", season: 2026, sport: "prizepicks", timezone: "UTC", log: () => {} };

function qualified(over: Partial<CanonicalOpportunityAssessment> = {}): CanonicalOpportunityAssessment {
  return {
    lineSnapshotId: "l1", playerId: 694973, gamePk: 2, market: "strikeouts", line: 5.5, side: "more",
    rawProbabilityMore: 0.75, rawProbabilityLess: 0.24, rawProbabilityPush: 0.01,
    calibratedProbabilityMore: 0.68, calibratedProbabilityLess: 0.31, calibrationAvailable: true,
    projectionMean: 6.3, projectionMedian: 6, baselineProbability: 0.44, modelAdvantage: 0.24,
    uncertaintyLow: 0.62, uncertaintyHigh: 0.82, dataQuality: 90, trainingSupport: 1,
    modelLifecycleState: "VALIDATED", fragility: 20, volatility: 20,
    scientificVetoes: [], status: "QUALIFIED_MORE", reasonCodes: ["OPPORTUNITY_QUALIFIED"],
    generatedAt: "2026-07-21T20:00:00Z", modelVersion: "m9", calibrationVersion: "c1", featureVersion: "f3",
    ...over,
  };
}

afterEach(() => { __resetOpportunitySource(); __resetChatHealthSource(); });

describe("getOpportunities tool", () => {
  it("returns NONE and a policy message when no opportunity qualifies (cannot fabricate a pick)", async () => {
    __setOpportunitySource(async () => []);
    const res = await getOpportunitiesTool.execute({ status: "QUALIFIED" }, ctx);
    expect(res.data.available).toBe(true);
    expect(res.data.rows.length).toBe(0);
    expect(res.warnings).toContain("No opportunity currently meets the policy.");
  });

  it("ranks qualified assessments verbatim (status + reasons match the canonical record)", async () => {
    const a = qualified();
    __setOpportunitySource(async () => [a, qualified({ lineSnapshotId: "l2", status: "NO_PLAY" })]);
    const res = await getOpportunitiesTool.execute({ status: "QUALIFIED" }, ctx);
    expect(res.data.rows.length).toBe(1); // the NO_PLAY is excluded
    const row = res.data.rows[0];
    expect(row.status).toBe("QUALIFIED_MORE");
    expect(row.primaryReasons).toEqual(a.reasonCodes.slice(0, 4));
    expect(row.calibratedProbability).toBe(0.68);
    expect(row.rawProbability).toBe(0.75); // distinct raw value
  });

  it("produces a transparent UNAVAILABLE result when the source fails (never a pick)", async () => {
    __setOpportunitySource(async () => { throw new Error("db down"); });
    const res = await getOpportunitiesTool.execute({ status: "QUALIFIED" }, ctx);
    expect(res.data.available).toBe(false);
    expect(res.data.rows.length).toBe(0);
    expect(res.warnings.join(" ")).toContain("temporarily unavailable");
  });
});

describe("getScientificMetrics tool", () => {
  it("queries PERSISTED metrics (not pretrained memory)", async () => {
    const rawData: ScientificRawData = {
      configured: true, serviceRole: true, connected: true, providers: [],
      tables: PERSISTENCE_TABLES.map((table) => ({ table, count: 10, latestAt: "2026-08-01T00:00:00Z" })),
      registry: [{
        id: "r1", market_key: "strikeouts", model_name: "sk", model_version: "v3", feature_version: "f2",
        lifecycle_status: "VALIDATED", algorithm: null, git_commit_sha: null, hyperparameters: null,
        created_at: "x", updated_at: "x", approved_at: null, approved_by: null, retired_at: null,
        suspended_at: null, suspended_reason: null, training_data_hash: null, training_period_end: null,
        training_period_start: null, training_support: null, validation_period_end: null, validation_period_start: null,
      }] as unknown as ScientificRawData["registry"],
      metrics: [], drift: [], breakers: [], ungradedCount: 0, temporalViolations: 0, lateObservations: 0,
    };
    __setChatHealthSource({ read: async () => rawData });
    const res = await getScientificMetricsTool.execute({}, ctx);
    expect(res.data.supabase).toBe("CONNECTED");
    expect(res.data.modelRegistry.length).toBe(1);
    expect(res.data.modelRegistry[0].market).toBe("strikeouts");
    expect(res.data.modelRegistry[0].state).toBe("VALIDATED");
  });
});
