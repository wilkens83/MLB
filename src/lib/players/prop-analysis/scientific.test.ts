import { describe, it, expect } from "bun:test";
import { buildScientific, buildMatchup } from "./assemble";
import { getMarketConfig } from "./market-config";
import { project } from "@/lib/prediction/projection";
import { simulate, recommend } from "@/lib/prediction/simulate";
import { analyzeStat } from "@/lib/analytics/hitRate";
import type { AnalysisPayload, EngineAnalysis } from "@/lib/mlb/analysis";
import { getProp } from "@/lib/props/catalog";
import type { StatcastPitcher, StatcastBatter } from "@/lib/domain/models";

function analysisFor(propKey: string, series: number[], line: number): EngineAnalysis {
  const prop = getProp(propKey)!;
  const projection = project({ series, family: prop.family });
  const projWithLambda = { ...projection, lambda: projection.shrunkMean, contextMultiplier: 1 };
  const simulation = simulate(projWithLambda, line, { seed: "test" });
  const analytics = analyzeStat(series, line, "over");
  const recommendation = recommend({ sim: simulation, sampleSize: series.length });
  return { prop, line, side: "over", projection: projWithLambda, simulation, analytics, recommendation, modeledBy: "marginal" };
}

function payloadWith(propKey: string, series: number[], line: number, opts: { pitcher?: Partial<StatcastPitcher>; batter?: Partial<StatcastBatter> } = {}): AnalysisPayload {
  return {
    player: { id: 1, name: "Test", position: propKey.startsWith("strike") || propKey.startsWith("pitcher") ? "P" : "RF", team: "PHI" },
    samples: series.map((value, i) => ({ value, date: `2026-06-${String(i + 1).padStart(2, "0")}`, opponent: "OPP" })),
    analysis: analysisFor(propKey, series, line),
    statcast: {
      pitcher: opts.pitcher ? ({ playerId: 1, season: 2026, availableMetrics: [], fetchedAt: Date.now(), ...opts.pitcher } as StatcastPitcher) : undefined,
      batter: opts.batter ? ({ playerId: 1, season: 2026, availableMetrics: [], fetchedAt: Date.now(), ...opts.batter } as StatcastBatter) : undefined,
    },
    opponent: null,
    breakdown: null,
    warnings: [],
    dataQuality: { score: 80, sampleSize: series.length, factors: [] } as unknown as AnalysisPayload["dataQuality"],
    provenance: null,
    meta: { propKey, line, sampleSize: series.length, filteredFrom: series.length, season: 2026 },
    lastUpdated: Date.now(),
  };
}

describe("scientific block keeps raw and calibrated DISTINCT", () => {
  const p = payloadWith("strikeouts", [10, 6, 7, 5, 9, 8, 11, 7], 5.5);

  it("never labels raw as calibrated — calibrated is null when no fit exists", () => {
    const sci = buildScientific(p, 5.5)!;
    expect(sci.calibrationAvailable).toBe(false);
    expect(sci.calibratedProbabilityMore).toBeNull();
    expect(sci.calibratedProbabilityLess).toBeNull();
    // raw is a real number, distinct from the (absent) calibrated value
    expect(sci.rawProbabilityMore).toBeGreaterThan(0);
    expect(sci.rawProbabilityMore).toBeLessThan(1);
  });

  it("does NOT claim a model advantage without calibration", () => {
    const sci = buildScientific(p, 5.5)!;
    expect(sci.modelAdvantagePp).toBeNull(); // requires calibrated probability
    expect(sci.baselineProbability).not.toBeNull(); // baseline is still computed
  });

  it("exposes an honest projection band + separated uncertainty, and a lifecycle that is not BET-eligible by default", () => {
    const sci = buildScientific(p, 5.5)!;
    expect(sci.projection.band[0]).toBeLessThanOrEqual(sci.projection.band[1]);
    expect(sci.projection.bandLabel).toBe("P10–P90");
    expect(sci.uncertaintyHalfWidth95).not.toBeNull();
    expect(sci.modelLifecycle).toBe("RESEARCH_ONLY");
  });

  it("reports a fragility level (never fabricated as certain)", () => {
    const sci = buildScientific(p, 5.5)!;
    expect(["LOW", "MODERATE", "HIGH", "EXTREME"]).toContain(sci.fragilityLevel);
  });
});

describe("percentile matchup requires a reference population", () => {
  it("shows raw Statcast values but marks percentiles N/A (null), never invented", () => {
    const cfg = getMarketConfig("strikeouts")!;
    const p = payloadWith("strikeouts", [10, 6, 7], 5.5, { pitcher: { kPct: 30.5, bbPct: 6.8, whiffPct: 28.9, xwoba: 0.27 } });
    const m = buildMatchup(p, cfg);
    expect(m.available).toBe(true);
    expect(m.referenceSize).toBeNull(); // no population loaded
    const kRow = m.rows.find((r) => r.metric === "kPct")!;
    expect(kRow.playerValue).toBe(30.5);
    expect(kRow.playerPercentile).toBeNull(); // percentile NOT invented
    expect(m.note).toMatch(/reference population/i);
  });

  it("degrades to unavailable when the player has no Statcast profile", () => {
    const cfg = getMarketConfig("hits")!;
    const p = payloadWith("hits", [1, 2, 0], 0.5);
    const m = buildMatchup(p, cfg);
    expect(m.available).toBe(false);
  });
});
