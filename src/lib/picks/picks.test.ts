import { describe, it, expect } from "bun:test";
import { project } from "@/lib/prediction/projection";
import { simulate, recommend, type SimulationResult } from "@/lib/prediction/simulate";
import { analyzeStat } from "@/lib/analytics/hitRate";
import { computeModelEnsemble } from "@/lib/models";
import { classifyPitcherRole, classifyHitterRole } from "@/lib/players/role";
import { scoreDataQuality } from "@/lib/prediction/quality";
import { getProp } from "@/lib/props/catalog";
import type { AnalysisPayload } from "@/lib/mlb/analysis";
import type { PrizePicksPlayerResolution } from "@/lib/prizepicks/types";

import { decidePick, buildExplanation, projectionStatus, projectionScore } from "./decide";
import { rankPicks, comparePicks } from "./rank";
import { probsFromDistribution, analyzeAltLines, fragilityProxy } from "./distribution";
import { eligibleProps } from "./eligible";
import { analyzePlayerPicks, type PicksDeps } from "./orchestrator";
import type { PlayerPickCandidate } from "./types";

/* -------------------------------------------------------------------------- */
/* Pure decision layer                                                         */
/* -------------------------------------------------------------------------- */

const baseDecide = {
  resolved: true,
  marketSupported: true,
  hasLine: true,
  dataQuality: 85,
  disagreement: "low" as const,
  fragility: "LOW" as const,
  warnings: [] as { code: string; severity: "info" | "warn" | "high" }[],
};

describe("decidePick", () => {
  it("qualifies a strong, robust candidate", () => {
    const d = decidePick({ ...baseDecide, probMore: 0.64, probLess: 0.36 });
    expect(d.decision).toBe("qualified");
    expect(d.preferredSide).toBe("more");
  });

  it("prefers the LESS side when under-probability is higher", () => {
    const d = decidePick({ ...baseDecide, probMore: 0.37, probLess: 0.63 });
    expect(d.decision).toBe("qualified");
    expect(d.preferredSide).toBe("less");
  });

  it("downgrades to WATCH when probability is modest", () => {
    const d = decidePick({ ...baseDecide, probMore: 0.54, probLess: 0.46 });
    expect(d.decision).toBe("watch");
  });

  it("rejects when there is no edge", () => {
    const d = decidePick({ ...baseDecide, probMore: 0.5, probLess: 0.5 });
    expect(d.decision).toBe("rejected");
  });

  it("EXTREME fragility rejects even a high probability (no buying past fragility)", () => {
    const d = decidePick({ ...baseDecide, probMore: 0.78, probLess: 0.22, fragility: "EXTREME" });
    expect(d.decision).toBe("rejected");
  });

  it("HIGH fragility cannot qualify — caps at WATCH", () => {
    const d = decidePick({ ...baseDecide, probMore: 0.7, probLess: 0.3, fragility: "HIGH" });
    expect(d.decision).toBe("watch");
  });

  it("high model disagreement cannot qualify", () => {
    const d = decidePick({ ...baseDecide, probMore: 0.7, probLess: 0.3, disagreement: "high" });
    expect(d.decision).toBe("watch");
  });

  it("unresolved player/game ⇒ UNAVAILABLE", () => {
    const d = decidePick({ ...baseDecide, resolved: false, probMore: 0.7, probLess: 0.3 });
    expect(d.decision).toBe("unavailable");
  });

  it("no line ⇒ projection_only (never a fabricated pick)", () => {
    const d = decidePick({ ...baseDecide, hasLine: false, probMore: undefined, probLess: undefined });
    expect(d.decision).toBe("projection_only");
  });

  it("critical warning ⇒ UNAVAILABLE", () => {
    const d = decidePick({ ...baseDecide, probMore: 0.7, probLess: 0.3, warnings: [{ code: "post_start", severity: "high" }] });
    expect(d.decision).toBe("unavailable");
  });
});

/* -------------------------------------------------------------------------- */
/* Projection-quality status + score (no line)                                 */
/* -------------------------------------------------------------------------- */

describe("projectionStatus (deterministic, never a MORE/LESS pick)", () => {
  it("grades a strong, well-supported projection", () => {
    expect(projectionStatus({ dataQuality: 90, fragility: "LOW", disagreement: "low", sampleSize: 40 })).toBe("strong");
  });
  it("flags volatility when fragile or high disagreement", () => {
    expect(projectionStatus({ dataQuality: 90, fragility: "HIGH", disagreement: "low", sampleSize: 40 })).toBe("volatile");
    expect(projectionStatus({ dataQuality: 90, fragility: "LOW", disagreement: "high", sampleSize: 40 })).toBe("volatile");
  });
  it("flags limited data on a tiny sample or poor quality", () => {
    expect(projectionStatus({ dataQuality: 90, fragility: "LOW", disagreement: "low", sampleSize: 3 })).toBe("limited_data");
    expect(projectionStatus({ dataQuality: 30, fragility: "LOW", disagreement: "low", sampleSize: 40 })).toBe("limited_data");
  });
  it("is favorable / neutral in the middle", () => {
    expect(projectionStatus({ dataQuality: 65, fragility: "MODERATE", disagreement: "low", sampleSize: 20 })).toBe("favorable");
    expect(projectionStatus({ dataQuality: 50, fragility: "MODERATE", disagreement: "medium", sampleSize: 20 })).toBe("neutral");
  });
  it("projectionScore rewards quality + sample + stability", () => {
    const strong = projectionScore({ dataQuality: 90, fragility: "LOW", disagreement: "low", sampleSize: 40 });
    const weak = projectionScore({ dataQuality: 45, fragility: "HIGH", disagreement: "high", sampleSize: 6 });
    expect(strong).toBeGreaterThan(weak);
  });
});

describe("buildExplanation is quantitative and mode-aware", () => {
  it("line mode: states the projection-vs-line gap numerically and never over-claims calibration", () => {
    const { reasons, risks } = buildExplanation({
      propLabel: "Strikeouts", line: 5.5, preferredSide: "more", projection: 6.48,
      probMore: 0.72, probLess: 0.28, recent: {}, fragility: "LOW", disagreement: "low",
      dataQuality: 73, sampleSize: 20, modelProbabilityRange: 0.05, context: {}, engineWarnings: [],
    });
    expect(reasons.some((r) => r.includes("6.48") && r.includes("5.5"))).toBe(true);
    expect(risks.some((r) => /uncalibrated/i.test(r))).toBe(true);
  });
  it("projection-only mode: no MORE/LESS/edge language, projection-focused reasons", () => {
    const { reasons, risks } = buildExplanation({
      propLabel: "Strikeouts", projection: 6.48, recent: {}, fragility: "LOW", disagreement: "low",
      dataQuality: 73, sampleSize: 20, context: {}, engineWarnings: [],
    });
    expect(reasons.some((r) => r.includes("6.48"))).toBe(true);
    // No positive reason may assert a MORE/LESS/edge (the risk note may mention
    // them only to DISCLAIM that no edge is claimed).
    const reasonText = reasons.join(" ").toLowerCase();
    expect(reasonText).not.toContain("more");
    expect(reasonText).not.toContain("less");
    expect(reasonText).not.toContain("edge");
    expect(risks.some((r) => /no market line|no more\/less edge/i.test(r))).toBe(true);
  });
});

/* -------------------------------------------------------------------------- */
/* Ranking                                                                     */
/* -------------------------------------------------------------------------- */

function candidate(partial: Partial<PlayerPickCandidate> & { propKey: string; decision: PlayerPickCandidate["decision"]; score: number }): PlayerPickCandidate {
  return {
    playerId: 1, propKey: partial.propKey, propLabel: partial.propKey, category: "pitcher",
    projection: 5, recent: {}, model: { disagreement: "low", dataQuality: 80, fragility: "LOW", calibration: "raw" },
    context: {}, altLines: [], decision: partial.decision, score: partial.score, reasons: [], risks: [],
    fullAnalysisHref: "#", warnings: [], ...partial,
  };
}

describe("rankPicks", () => {
  it("QUALIFIED beats WATCH beats REJECTED regardless of raw score", () => {
    const cands = [
      candidate({ propKey: "a", decision: "rejected", score: 99 }),
      candidate({ propKey: "b", decision: "watch", score: 10 }),
      candidate({ propKey: "c", decision: "qualified", score: 20 }),
    ];
    const { allProps } = rankPicks(cands);
    expect(allProps.map((c) => c.decision)).toEqual(["qualified", "watch", "rejected"]);
  });

  it("a high-probability but EXTREME-fragility (rejected) candidate never ranks first", () => {
    const cands = [
      candidate({ propKey: "fragile", decision: "rejected", score: 95 }),
      candidate({ propKey: "solid", decision: "qualified", score: 40 }),
    ];
    const { allProps, topPicks } = rankPicks(cands);
    expect(allProps[0].propKey).toBe("solid");
    expect(topPicks[0].propKey).toBe("solid");
  });

  it("returns NO STRONG PICK when nothing qualifies", () => {
    const cands = [
      candidate({ propKey: "a", decision: "watch", score: 60 }),
      candidate({ propKey: "b", decision: "rejected", score: 80 }),
    ];
    const { topPicks, noStrongPick } = rankPicks(cands);
    expect(topPicks).toHaveLength(0);
    expect(noStrongPick).toBe(true);
  });

  it("caps Top Picks at 3 and separates projection-only props", () => {
    const cands = [
      candidate({ propKey: "a", decision: "qualified", score: 50 }),
      candidate({ propKey: "b", decision: "qualified", score: 60 }),
      candidate({ propKey: "c", decision: "qualified", score: 70 }),
      candidate({ propKey: "d", decision: "qualified", score: 80 }),
      candidate({ propKey: "e", decision: "projection_only", score: 0 }),
    ];
    const { topPicks, projectionOnly, allProps } = rankPicks(cands);
    expect(topPicks).toHaveLength(3);
    expect(topPicks.map((c) => c.propKey)).toEqual(["d", "c", "b"]);
    expect(projectionOnly.map((c) => c.propKey)).toEqual(["e"]);
    expect(allProps.some((c) => c.decision === "projection_only")).toBe(false);
  });

  it("comparePicks is a total order (deterministic)", () => {
    const a = candidate({ propKey: "a", decision: "qualified", score: 50 });
    const b = candidate({ propKey: "b", decision: "qualified", score: 50 });
    expect(Math.sign(comparePicks(a, b))).toBe(-Math.sign(comparePicks(b, a)));
  });
});

/* -------------------------------------------------------------------------- */
/* Alternative lines — same distribution, only threshold moves                 */
/* -------------------------------------------------------------------------- */

describe("alternative lines", () => {
  // A simple discrete distribution centered near 7.
  const dist = [
    { value: 4, probability: 0.05 },
    { value: 5, probability: 0.1 },
    { value: 6, probability: 0.2 },
    { value: 7, probability: 0.3 },
    { value: 8, probability: 0.2 },
    { value: 9, probability: 0.1 },
    { value: 10, probability: 0.05 },
  ];

  it("probability increases as the MORE threshold drops (same distribution)", () => {
    const p55 = probsFromDistribution(dist, 5.5).probMore;
    const p65 = probsFromDistribution(dist, 6.5).probMore;
    const p75 = probsFromDistribution(dist, 7.5).probMore;
    expect(p55).toBeGreaterThan(p65);
    expect(p65).toBeGreaterThan(p75);
  });

  it("labels the standard, highest and avoid thresholds without changing the projection", () => {
    const alt = analyzeAltLines(
      dist,
      { line: 6.5, projectionType: "standard" },
      [
        { line: 5.5, projectionType: "goblin" },
        { line: 8.5, projectionType: "demon" },
      ],
    );
    const standard = alt.find((a) => a.line === 6.5)!;
    const goblin = alt.find((a) => a.line === 5.5)!;
    const demon = alt.find((a) => a.line === 8.5)!;
    expect(standard.label).toBe("standard");
    expect(goblin.label).toBe("highest"); // lowest line ⇒ highest MORE prob
    expect(demon.label).toBe("avoid"); // MORE prob below a coin flip
  });

  it("probsFromDistribution normalizes and preserves push mass on integer lines", () => {
    const p = probsFromDistribution(dist, 7);
    expect(p.probPush).toBeCloseTo(0.3, 5);
    expect(p.probMore + p.probLess + p.probPush).toBeCloseTo(1, 5);
  });
});

describe("fragilityProxy", () => {
  it("is LOW when the projection sits far from the line (robust side)", () => {
    const sim = { mean: 7, stdDev: 2 } as SimulationResult;
    expect(fragilityProxy(sim, 4.5)).toBe("LOW"); // z = 1.25
  });

  it("is EXTREME when the projection sits on the line (coin-flip side)", () => {
    const sim = { mean: 6.48, stdDev: 2.8 } as SimulationResult;
    expect(fragilityProxy(sim, 6.5)).toBe("EXTREME"); // z ≈ 0.007
  });

  it("degrades monotonically as the projection nears the line", () => {
    const sim = { mean: 7, stdDev: 2 } as SimulationResult;
    const far = fragilityProxy(sim, 4.5); // z=1.25 LOW
    const mid = fragilityProxy(sim, 6.1); // z=0.45 MODERATE
    const near = fragilityProxy(sim, 6.6); // z=0.20 HIGH
    expect(far).toBe("LOW");
    expect(mid).toBe("MODERATE");
    expect(near).toBe("HIGH");
  });
});

/* -------------------------------------------------------------------------- */
/* Eligible prop discovery (catalog-driven, role-based)                        */
/* -------------------------------------------------------------------------- */

describe("eligibleProps", () => {
  it("pitchers get only pitcher-category props", () => {
    const keys = eligibleProps(true).map((p) => p.key);
    expect(keys).toContain("strikeouts");
    expect(keys).toContain("hits_allowed");
    expect(keys).not.toContain("home_runs"); // batter market
    expect(keys.every((k) => getProp(k)!.category === "pitcher")).toBe(true);
  });

  it("hitters get only batter-category props", () => {
    const keys = eligibleProps(false).map((p) => p.key);
    expect(keys).toContain("hits");
    expect(keys).toContain("total_bases");
    expect(keys).not.toContain("strikeouts"); // pitcher market
    expect(keys.every((k) => getProp(k)!.category === "batter")).toBe(true);
  });
});

/* -------------------------------------------------------------------------- */
/* Orchestrator (offline, real engine via injected deps)                       */
/* -------------------------------------------------------------------------- */

/** Build a REAL analysis payload deterministically from a synthetic series. */
function makePayload(propKey: string, series: number[], line: number | undefined, opts: { hasStatcast?: boolean; hasOpponent?: boolean } = {}): AnalysisPayload {
  const prop = getProp(propKey)!;
  const isPitcher = prop.category === "pitcher";
  const effLine = line ?? prop.defaultLine;
  const seed = `test:${propKey}:${effLine}`;
  const projection = project({ series, family: prop.family });
  const sim = simulate(projection, effLine, { seed });
  const analytics = analyzeStat(series, effLine, "over");
  const ensemble = computeModelEnsemble({ series, family: prop.family, line: effLine, seed, marginalSim: sim, modelVersion: "test" });
  const hasStatcast = opts.hasStatcast ?? true;
  const dq = scoreDataQuality({ sampleSize: series.length, hasStatcast, hasOpponent: opts.hasOpponent ?? false, hasWeather: false, hasLineup: false });
  const samples = series.map((v, i) => ({ value: v, isHome: i % 2 === 0, opponent: "DET", date: `2026-05-${String(10 + i).padStart(2, "0")}` }));
  const pitcherStatcast = hasStatcast
    ? { playerId: 100, season: 2026, kPct: 31, bbPct: 6, whiffPct: 34, availableMetrics: ["kPct", "bbPct", "whiffPct"], fetchedAt: Date.now() }
    : undefined;
  return {
    player: { id: 100, name: "Test Player", position: isPitcher ? "P" : "CF", team: "TST", bats: "R", throws: "R" },
    samples,
    analysis: {
      prop, line: effLine, side: "over", projection, simulation: sim, analytics,
      recommendation: recommend({ sim, sampleSize: series.length }),
      modeledBy: isPitcher ? "pitcher-joint" : "marginal",
      role: isPitcher ? classifyPitcherRole({ playerId: 100 }) : classifyHitterRole({}),
      models: ensemble.models, ensemble: ensemble.ensemble, modelDisagreement: ensemble.disagreement,
      ...(isPitcher
        ? {
            pitcherUsage: {
              expectedPitches: 92, expectedBattersFaced: 24, expectedOuts: 17, expectedInnings: 5.7,
              pitches: { mean: 92, median: 92, stdDev: 8, p10: 80, p90: 104 },
              battersFaced: { mean: 24, median: 24, stdDev: 3, p10: 20, p90: 28 },
              outs: { mean: 17, median: 17, stdDev: 3, p10: 13, p90: 21 },
              outsExceedance: { p15: 0.7, p18: 0.4, p21: 0.15 },
              inningsExceedance: { ip5: 0.7, ip6: 0.4, ip7: 0.15 },
              removalRisk: { pBefore6IP: 0.55, meanHookPitchCount: 96, hookReason: { pitchCount: 0.4, performance: 0.3, capped: 0.3 } },
              provenance: { version: "test", startsUsed: 8, hadPitchCounts: true, hadBattersFaced: true, sources: {}, warnings: [], generatedAt: Date.now() },
            },
            pitcherJoint: {
              volumeEfficiency: { expectedBattersFaced: 24, expectedPitches: 92, expectedOuts: 17, rates: { kPerBf: 0.27, bbPerBf: 0.07, hPerBf: 0.22, hrPerBf: 0.03 } },
              correlations: [], version: "test",
            },
          }
        : {}),
    },
    statcast: isPitcher ? { pitcher: pitcherStatcast } : {},
    opponent: { opponentTeam: "DET", gamePk: 777, lineupConfirmed: false, starterConfirmed: true },
    breakdown: { base: projection.shrunkMean, final: projection.lambda, factors: [
      { key: "park", label: "Park (Citi Field)", delta: 0.1, multiplier: 0.98, direction: "down" },
      { key: "form", label: "Recent form", delta: 0.2, multiplier: 1.05, direction: "up" },
    ] },
    warnings: [],
    dataQuality: dq,
    provenance: { modelVersion: "test", seed, dataTimestamp: Date.now(), sources: [] },
    meta: { propKey, line: effLine, sampleSize: series.length, filteredFrom: series.length, season: 2026 },
    lastUpdated: Date.now(),
  };
}

function fakeResolve(over: Partial<NonNullable<PrizePicksPlayerResolution["chosen"]>> = {}): PicksDeps["resolve"] {
  const chosen = {
    mlbPlayerId: 100, fullName: "Test Player", position: "P", isPitcher: true,
    teamId: 5, teamName: "Test Team", gamePk: 777, opponentName: "DET", ...over,
  };
  return async () => ({ status: "resolved", candidates: [chosen], chosen, reason: "test" });
}

/** Offline game-detail resolver — keeps the orchestrator off the network in tests. */
const fakeGame: NonNullable<PicksDeps["getGame"]> = async () => ({
  gamePk: 777, opponentName: "New York Mets", venueName: "Citi Field", gameStartTime: "2026-05-19T23:10:00Z", homeAway: "away",
});

/** Build test deps with an offline game resolver. */
function D(analyze: PicksDeps["analyze"], resolveOver: Partial<NonNullable<PrizePicksPlayerResolution["chosen"]>> = {}): PicksDeps {
  return { analyze, resolve: fakeResolve(resolveOver), getGame: fakeGame };
}

describe("analyzePlayerPicks — orchestration", () => {
  it("returns 'no scheduled game' without fabricating an opponent", async () => {
    const result = await analyzePlayerPicks(
      { playerId: 100 },
      D((async () => makePayload("strikeouts", [7], 6.5)) as never, { gamePk: undefined }),
    );
    expect(result.game.resolved).toBe(false);
    expect(result.game.reason).toContain("No scheduled MLB game");
    expect(result.topPicks).toHaveLength(0);
  });

  it("analyzes only pitcher props for a pitcher and never a batter prop", async () => {
    const analyzed: string[] = [];
    const analyze = (async (req: { propKey: string; line?: number }) => {
      analyzed.push(req.propKey);
      return makePayload(req.propKey, [7, 8, 6, 9, 7, 8], req.line);
    }) as never;
    const result = await analyzePlayerPicks({ playerId: 100 }, D(analyze));
    expect(analyzed).toContain("strikeouts");
    expect(analyzed).not.toContain("home_runs");
    expect(result.allProps.concat(result.projectionOnly).every((c) => c.category === "pitcher")).toBe(true);
  });

  it("resolves real game details (venue/opponent/home-away) and exposes an honest status summary", async () => {
    const analyze = (async (req: { propKey: string; line?: number }) => makePayload(req.propKey, [7, 8, 6, 9, 7, 8], req.line)) as never;
    const result = await analyzePlayerPicks({ playerId: 100, lines: [{ marketKey: "strikeouts", line: 4.5 }] }, D(analyze));
    expect(result.game.venueName).toBe("Citi Field");
    expect(result.game.opponentName).toBe("New York Mets");
    expect(result.game.homeAway).toBe("away");
    expect(result.player.throws).toBe("R");
    const s = result.status;
    expect(s.qualified + s.watch + s.rejected + s.unavailable + s.projectionOnly).toBe(
      result.allProps.length + result.projectionOnly.length,
    );
  });

  it("surfaces pitcher usage + volume/efficiency on pitcher props", async () => {
    const analyze = (async (req: { propKey: string; line?: number }) => makePayload(req.propKey, [7, 8, 6, 9, 7, 8], req.line)) as never;
    const result = await analyzePlayerPicks({ playerId: 100, lines: [{ marketKey: "strikeouts", line: 5.5 }] }, D(analyze));
    const k = result.allProps.find((c) => c.propKey === "strikeouts")!;
    expect(k.pitcherUsage?.expectedInnings).toBe(5.7);
    expect(k.pitcherUsage?.removalRisk.pBefore6IP).toBeGreaterThan(0);
    expect(k.volumeEfficiency?.rates.kPerBf).toBeGreaterThan(0);
  });

  it("exposes real recent games, adjustment factors and Statcast metrics (never fabricated)", async () => {
    const analyze = (async (req: { propKey: string; line?: number }) => makePayload(req.propKey, [9, 10, 8, 11, 9, 10, 9, 8], req.line)) as never;
    const result = await analyzePlayerPicks({ playerId: 100, lines: [{ marketKey: "strikeouts", line: 5.5 }] }, D(analyze));
    const k = result.allProps.find((c) => c.propKey === "strikeouts")!;
    expect(k.recentGames && k.recentGames.length).toBeGreaterThan(0);
    expect(k.recentGames!.every((g) => typeof g.hit === "boolean")).toBe(true); // line mode ⇒ hit defined
    expect(k.adjustmentFactors!.some((f) => f.key === "park")).toBe(true);
    expect(k.statcast!.some((m) => m.key === "kPct")).toBe(true);
    expect(k.sampleSize).toBe(8);
  });

  it("MODE B: with no imported line every prop is projection_only (no fabricated pick)", async () => {
    const analyze = (async (req: { propKey: string; line?: number }) => makePayload(req.propKey, [7, 8, 6, 9, 7], req.line)) as never;
    const result = await analyzePlayerPicks({ playerId: 100 }, D(analyze));
    expect(result.topPicks).toHaveLength(0);
    expect(result.noStrongPick).toBe(true);
    expect(result.projectionOnly.length).toBeGreaterThan(0);
    for (const c of result.projectionOnly) {
      expect(c.decision).toBe("projection_only");
      expect(c.probMore).toBeUndefined();
      expect(c.probLess).toBeUndefined();
      expect(c.preferredSide).toBeUndefined();
      expect(c.projection).toBeGreaterThan(0); // projection still available
      // Deep-analysis data IS available without a line (item 6):
      expect(c.distribution && c.distribution.length).toBeGreaterThan(0);
      expect(c.modelProjections).toBeDefined();
      expect(c.projectionStatus).toBeDefined();
      expect(c.recent.l10?.stdDev !== undefined || c.recent.season?.stdDev !== undefined).toBe(true);
      expect(c.trend).toBeDefined();
    }
    // Projection-only props are ranked by projection strength (desc), not alphabetical.
    const scores = result.projectionOnly.map((c) => c.projectionScore ?? 0);
    for (let i = 1; i < scores.length; i++) expect(scores[i - 1]).toBeGreaterThanOrEqual(scores[i]);
  });

  it("MODE A: an imported line drives a line-mode candidate with both sides + full-analysis link", async () => {
    const analyze = (async (req: { propKey: string; line?: number }) => makePayload(req.propKey, [9, 10, 8, 11, 9, 10, 9, 8], req.line)) as never;
    const result = await analyzePlayerPicks(
      { playerId: 100, lines: [{ marketKey: "strikeouts", line: 5.5 }] },
      D(analyze),
    );
    const k = result.allProps.find((c) => c.propKey === "strikeouts")!;
    expect(k.line).toBe(5.5);
    expect(k.probMore).toBeGreaterThan(0);
    expect(k.probLess).toBeGreaterThan(0);
    expect(k.preferredSide).toBe("more"); // projection ~9 over 5.5
    expect(k.fullAnalysisHref).toContain("market=strikeouts");
    expect(k.fullAnalysisHref).toContain("line=5.5");
  });

  it("historical hit rate is exposed separately and never as the model probability", async () => {
    const analyze = (async (req: { propKey: string; line?: number }) => makePayload(req.propKey, [9, 10, 8, 11, 9, 10], req.line)) as never;
    const result = await analyzePlayerPicks(
      { playerId: 100, lines: [{ marketKey: "strikeouts", line: 5.5 }] },
      D(analyze),
    );
    const k = result.allProps.find((c) => c.propKey === "strikeouts")!;
    // recent.l10.hitRate is a HISTORICAL rate; probMore is the model probability — distinct fields.
    expect(k.recent.l10?.hitRate).toBeDefined();
    expect(k.probMore).toBeDefined();
    expect(k.recent).not.toHaveProperty("probMore");
  });

  it("alt lines reuse the SAME projection; only threshold probabilities change", async () => {
    const analyze = (async (req: { propKey: string; line?: number }) => makePayload(req.propKey, [7, 8, 6, 9, 7, 8, 7], req.line)) as never;
    const result = await analyzePlayerPicks(
      { playerId: 100, lines: [{ marketKey: "strikeouts", line: 6.5, alternativeLines: [{ line: 4.5 }, { line: 8.5 }] }] },
      D(analyze),
    );
    const k = result.allProps.find((c) => c.propKey === "strikeouts")!;
    expect(k.altLines.length).toBe(3); // primary + 2 alternatives
    const low = k.altLines.find((a) => a.line === 4.5)!;
    const high = k.altLines.find((a) => a.line === 8.5)!;
    expect(low.probMore).toBeGreaterThan(high.probMore); // lower threshold ⇒ higher MORE prob
  });

  it("CONSOLIDATION: a pitcher's imported alt lines reuse the ONE joint distribution + usage (PR#32 × PR#36)", async () => {
    const analyze = (async (req: { propKey: string; line?: number }) => makePayload(req.propKey, [7, 8, 6, 9, 7, 8, 7], req.line)) as never;
    const result = await analyzePlayerPicks(
      { playerId: 100, lines: [{ marketKey: "strikeouts", line: 6.5, alternativeLines: [{ line: 4.5 }, { line: 8.5 }] }] },
      D(analyze),
    );
    const k = result.allProps.find((c) => c.propKey === "strikeouts")!;
    // #32 alt lines: goblin/standard/demon are the same market at 3 thresholds,
    // all read from the SAME distribution (lower line ⇒ higher MORE prob).
    expect(k.altLines.length).toBe(3);
    expect(k.altLines.find((a) => a.line === 4.5)!.probMore).toBeGreaterThan(k.altLines.find((a) => a.line === 8.5)!.probMore);
    // #36 pitcher usage/volume-efficiency coexists on the same pitcher prop.
    expect(k.pitcherUsage?.expectedInnings).toBeGreaterThan(0);
    expect(k.volumeEfficiency?.rates.kPerBf).toBeGreaterThan(0);
  });

  it("is deterministic — identical inputs produce identical rankings", async () => {
    const analyze = (async (req: { propKey: string; line?: number }) => makePayload(req.propKey, [8, 9, 7, 10, 8, 9, 8], req.line)) as never;
    const lines = [{ marketKey: "strikeouts", line: 6.5 }, { marketKey: "hits_allowed", line: 5.5 }];
    const r1 = await analyzePlayerPicks({ playerId: 100, lines }, D(analyze));
    const r2 = await analyzePlayerPicks({ playerId: 100, lines }, D(analyze));
    expect(r1.allProps.map((c) => `${c.propKey}:${c.decision}:${c.score}`)).toEqual(
      r2.allProps.map((c) => `${c.propKey}:${c.decision}:${c.score}`),
    );
  });

  it("a prop whose analysis throws degrades to UNAVAILABLE (never fabricated)", async () => {
    const analyze = (async (req: { propKey: string; line?: number }) => {
      if (req.propKey === "earned_runs") throw new Error("boom");
      return makePayload(req.propKey, [7, 8, 6, 9, 7], req.line);
    }) as never;
    const result = await analyzePlayerPicks({ playerId: 100 }, D(analyze));
    const er = result.allProps.concat(result.projectionOnly).find((c) => c.propKey === "earned_runs")!;
    expect(er.decision).toBe("unavailable");
  });
});
