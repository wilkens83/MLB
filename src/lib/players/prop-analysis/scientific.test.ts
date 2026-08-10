import { describe, it, expect } from "bun:test";
import { buildScientific, buildDecision } from "./assemble";
import { buildPercentileRows, aggregateLineupProfile } from "./percentiles";
import { project } from "@/lib/prediction/projection";
import { simulate, recommend } from "@/lib/prediction/simulate";
import { analyzeStat } from "@/lib/analytics/hitRate";
import { computeModelEnsemble } from "@/lib/models";
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
  const me = computeModelEnsemble({ series, family: prop.family, line, seed: "test", marginalSim: simulation, modelVersion: "test" });
  return {
    prop, line, side: "over", projection: projWithLambda, simulation, analytics, recommendation, modeledBy: "marginal",
    models: me.models, ensemble: me.ensemble, modelDisagreement: me.disagreement,
  };
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

  it("exposes an honest projection band, IQR, separated uncertainty, threshold, and a non-BET lifecycle", () => {
    const sci = buildScientific(p, 5.5)!;
    expect(sci.projection.band[0]).toBeLessThanOrEqual(sci.projection.band[1]);
    expect(sci.projection.bandLabel).toBe("P10–P90");
    expect(sci.projection.iqr === null || sci.projection.iqr[0] <= sci.projection.iqr[1]).toBe(true);
    expect(sci.uncertaintyHalfWidth95).not.toBeNull();
    expect(sci.policyThresholdPct).toBeGreaterThan(0);
    expect(sci.volatility).toBeGreaterThanOrEqual(0);
    expect(sci.modelLifecycle).toBe("RESEARCH_ONLY");
    expect(sci.calibrationVersion).toBeNull(); // no fit
  });

  it("reports a fragility level (never fabricated as certain)", () => {
    const sci = buildScientific(p, 5.5)!;
    expect(["LOW", "MODERATE", "HIGH", "EXTREME"]).toContain(sci.fragilityLevel);
  });
});

const B = (over: Partial<StatcastBatter>): StatcastBatter =>
  ({ playerId: 0, season: 2026, availableMetrics: [], fetchedAt: 0, ...over }) as StatcastBatter;
const P = (over: Partial<StatcastPitcher>): StatcastPitcher =>
  ({ playerId: 0, season: 2026, availableMetrics: [], fetchedAt: 0, ...over }) as StatcastPitcher;

describe("percentile matchup uses a REAL reference population (never invented)", () => {
  // A population of 30 batters/pitchers with spread K% so percentiles are meaningful.
  const batterPop = Array.from({ length: 30 }, (_, i) => B({ kPct: 10 + i, whiffPct: 15 + i, xwoba: 0.28 + i * 0.005, bbPct: 5 + i * 0.3, hardHitPct: 30 + i, barrelPct: 4 + i * 0.3 }));
  const pitcherPop = Array.from({ length: 30 }, (_, i) => P({ kPct: 12 + i, whiffPct: 18 + i, xwoba: 0.27 + i * 0.005, bbPct: 4 + i * 0.3, hardHitPctAllowed: 28 + i, barrelPctAllowed: 3 + i * 0.3 }));

  it("computes percentiles from the population and derives a real advantage direction", () => {
    const batter = B({ kPct: 12, whiffPct: 17, xwoba: 0.30, bbPct: 8 }); // low-K contact hitter
    const pitcher = P({ kPct: 40, whiffPct: 46, xwoba: 0.28, bbPct: 4 }); // elite K pitcher
    const { rows, referenceSize } = buildPercentileRows(batter, pitcher, batterPop, pitcherPop, "batter");
    expect(referenceSize).toBe(30);
    const kRow = rows.find((r) => r.metric === "K%")!;
    expect(kRow.playerPercentile).not.toBeNull(); // REAL percentile, not N/A
    expect(kRow.opponentPercentile).not.toBeNull();
    expect(kRow.edge).not.toBeNull();
  });

  it("marks percentiles N/A when the population is too small (never fabricated)", () => {
    const batter = B({ kPct: 20 });
    const pitcher = P({ kPct: 25 });
    const { rows, referenceSize } = buildPercentileRows(batter, pitcher, [batter], [pitcher], "batter");
    expect(referenceSize).toBeNull(); // < 20 players → no valid reference
    const kRow = rows.find((r) => r.metric === "K%")!;
    expect(kRow.playerPercentile).toBeNull();
    expect(kRow.edge).toBeNull(); // cannot derive an edge without percentiles
  });

  it("aggregates a lineup profile PA-weighted, skipping missing values (never zero-filled)", () => {
    const lineup = [B({ kPct: 20, pa: 100 }), B({ kPct: 30, pa: 300 }), B({ whiffPct: 25, pa: 200 })];
    const profile = aggregateLineupProfile(lineup)!;
    // PA-weighted K% = (20*100 + 30*300) / (100+300) = 27.5
    expect(profile.kPct).toBeCloseTo(27.5, 5);
    expect(profile.whiffPct).toBeCloseTo(25, 5);
  });
});

describe("scientific decision (canonical, explained, never a bare lean)", () => {
  const p = payloadWith("strikeouts", [10, 6, 7, 5, 9, 8], 5.5);
  const sci = buildScientific(p, 5.5);

  it("is NO_ACTIVE_LINE with a next-review condition when no line is supplied", () => {
    const d = buildDecision(p, sci, 5.5, false);
    expect(d.status).toBe("NO_ACTIVE_LINE");
    expect(d.fromCanonicalAssessment).toBe(false);
    expect(d.nextReview).toMatch(/line/i);
  });

  it("reads the canonical engine with a next-review condition when a line is active (never QUALIFIED without calibration)", () => {
    const d = buildDecision(p, sci, 5.5, true);
    expect(d.fromCanonicalAssessment).toBe(true);
    expect(["WATCH", "NO_PLAY", "UNAVAILABLE"]).toContain(d.status); // research-only ⇒ not QUALIFIED
    expect(d.nextReview.length).toBeGreaterThan(0);
    // Blockers explain WHY it is not a bet (calibration/validation), not a bare lean.
    expect(d.risks.join(" ").length).toBeGreaterThan(0);
  });
});
