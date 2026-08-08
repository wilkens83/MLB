import { describe, it, expect, afterEach } from "bun:test";
import { runDeterministic } from "./mock-provider";
import { buildToolRegistry } from "../tools";
import type { ProviderInput } from "./types";
import type { ChatToolContext, ToolResult } from "../tools/types";
import { classifyIntent } from "../server/intent";
import { __setOpportunitySource, __resetOpportunitySource } from "@/lib/prizepicks/opportunity/shared-store";
import type { CanonicalOpportunityAssessment } from "@/lib/prizepicks/opportunity/types";

/** A ProviderInput whose invoke dispatches to the REAL tool registry, so the
    canonical getOpportunities tool runs against the injected source. */
function makeInput(message: string): ProviderInput {
  const registry = buildToolRegistry();
  const context: ChatToolContext = { date: "2026-07-21", season: 2026, sport: "prizepicks", timezone: "UTC", log: () => {} };
  const invoke = async <T = unknown>(name: string, raw: unknown): Promise<ToolResult<T>> => {
    const tool = registry.get(name);
    if (!tool) throw new Error(`unknown tool ${name}`);
    return tool.execute(tool.inputSchema.parse(raw ?? {}), context) as Promise<ToolResult<T>>;
  };
  return { message, context, invoke };
}

const qualified = (over: Partial<CanonicalOpportunityAssessment> = {}): CanonicalOpportunityAssessment => ({
  lineSnapshotId: "l1", playerId: 694973, gamePk: 2, market: "strikeouts", line: 5.5, side: "more",
  rawProbabilityMore: 0.75, rawProbabilityLess: 0.24, rawProbabilityPush: 0.01,
  calibratedProbabilityMore: 0.68, calibratedProbabilityLess: 0.31, calibrationAvailable: true,
  projectionMean: 6.3, projectionMedian: 6, baselineProbability: 0.44, modelAdvantage: 0.24,
  uncertaintyLow: 0.62, uncertaintyHigh: 0.82, dataQuality: 90, trainingSupport: 1,
  modelLifecycleState: "VALIDATED", fragility: 20, volatility: 20,
  scientificVetoes: [], status: "QUALIFIED_MORE", reasonCodes: ["OPPORTUNITY_QUALIFIED"],
  generatedAt: "2026-07-21T20:00:00Z", modelVersion: "m9", calibrationVersion: "c1", featureVersion: "f3", ...over,
});

const run = (message: string) => runDeterministic(makeInput(message), { provider: "mock", developmentMode: true });

afterEach(() => __resetOpportunitySource());

describe("chat intent routing for opportunities", () => {
  it("routes 'best pick' and 'strongest lines' to the opportunity query (not raw edges)", () => {
    expect(classifyIntent("Give me your best pick").kind).toBe("best-opportunities");
    expect(classifyIntent("Which PrizePicks lines are strongest?").kind).toBe("best-opportunities");
    expect(classifyIntent("Show current WATCH candidates").kind).toBe("watch-candidates");
    expect(classifyIntent("Why did that get rejected?").kind).toBe("rejected-opportunities");
    expect(classifyIntent("What is the model performance by market?").kind).toBe("model-performance");
    expect(classifyIntent("What is the calibration status?").kind).toBe("calibration-status");
    expect(classifyIntent("Any active circuit breakers?").kind).toBe("scientific-breakers");
  });
});

describe("chat answers from canonical qualified opportunities", () => {
  it("'give me your best pick' with no qualifying candidate says the policy is not met — never invents one", async () => {
    __setOpportunitySource(async () => []);
    const { response } = await run("Give me your best pick");
    expect(response.answer).toContain("No opportunity currently meets the policy");
  });

  it("ranks a real qualified opportunity and shows raw + calibrated as distinct columns", async () => {
    __setOpportunitySource(async () => [qualified()]);
    const { response } = await run("Which PrizePicks lines are strongest?");
    const table = response.blocks.find((b) => b.type === "table") as { rows: Record<string, unknown>[] } | undefined;
    expect(table).toBeDefined();
    expect(table!.rows.length).toBe(1);
    expect(table!.rows[0].calibrated).toBe(0.68);
    expect(table!.rows[0].raw).toBe(0.75); // distinct — raw never relabeled calibrated
    expect(table!.rows[0].decision).toBe("QUALIFIED_MORE");
  });

  it("excludes a NO_PLAY (stale/unvalidated) line from the strongest list", async () => {
    __setOpportunitySource(async () => [qualified({ status: "NO_PLAY", reasonCodes: ["LINE_STALE"] })]);
    const { response } = await run("Give me your best pick");
    expect(response.answer).toContain("No opportunity currently meets the policy");
  });
});
