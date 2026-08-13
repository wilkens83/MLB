import { describe, it, expect } from "bun:test";
import {
  estimatePitcherRates, adjustPitcherRates, ratesPerBf, battersFacedOf, normalizeRates,
  projectWorkloadBudget, removalHazard, buildRemovalParams,
  simulatePitcherStart, buildPitcherJoint, MAX_START_OUTS,
  propSimulationFromJoint, jointCorrelation, jointProbBothMore,
  type PitcherStartStat, type PitcherRates, type LiveState,
} from "./index";
import { mulberry32 } from "@/lib/math/stats";

/** A realistic-ish set of starts for a strikeout-heavy starter. */
function starts(over: Partial<PitcherStartStat> = {}, n = 8): PitcherStartStat[] {
  return Array.from({ length: n }, (_, i) => ({
    battersFaced: 24, numberOfPitches: 92, outs: 18, strikeOuts: 7, baseOnBalls: 2,
    hits: 5, doubles: 1, triples: 0, homeRuns: 1, hitByPitch: 0, earnedRuns: 2,
    ...over,
    // tiny deterministic variation so recency has something to weight
    numberOfPitches: (over.numberOfPitches ?? 92) + (i % 3),
  }));
}

const IT = 3000;

/* ------------------------------- Rates ----------------------------------- */

describe("estimatePitcherRates", () => {
  it("produces a valid probability simplex (sums to 1 incl. out)", () => {
    const r = estimatePitcherRates(starts());
    const sum = r.k + r.bb + r.hbp + r.single + r.double + r.triple + r.hr + r.out;
    expect(sum).toBeCloseTo(1, 6);
    expect(r.out).toBeGreaterThan(0);
  });

  it("a higher K pitcher gets a higher K/BF rate", () => {
    const lowK = estimatePitcherRates(starts({ strikeOuts: 3 }));
    const highK = estimatePitcherRates(starts({ strikeOuts: 11 }));
    expect(highK.k).toBeGreaterThan(lowK.k);
  });

  it("event rates move independently — more walks doesn't raise the hit rate", () => {
    const base = estimatePitcherRates(starts());
    const highBB = estimatePitcherRates(starts({ baseOnBalls: 6 }));
    expect(highBB.bb).toBeGreaterThan(base.bb);
    expect(ratesPerBf(highBB).hPerBf).toBeLessThanOrEqual(ratesPerBf(base).hPerBf + 1e-9);
  });

  it("adjustPitcherRates applies per-event context multipliers", () => {
    const r = estimatePitcherRates(starts());
    const adj = adjustPitcherRates(r, { kMult: 1.3, hrMult: 1.5 });
    expect(adj.k).toBeGreaterThan(r.k);
    expect(adj.hr).toBeGreaterThan(r.hr);
  });

  it("battersFaced reconstructs from outs + baserunners when the field is missing", () => {
    expect(battersFacedOf({ outs: 18, hits: 5, baseOnBalls: 2, hitByPitch: 1 })).toBe(26);
    expect(battersFacedOf({ battersFaced: 24, outs: 18 })).toBe(24);
  });
});

/* ------------------------------ Workload --------------------------------- */

describe("projectWorkloadBudget", () => {
  it("uses real pitch counts when present (provenance = gamelog)", () => {
    const w = projectWorkloadBudget(starts());
    expect(w.provenance.hadPitchCounts).toBe(true);
    expect(w.provenance.sources.targetPitches).toBe("gamelog");
    expect(w.targetPitches).toBeGreaterThan(80);
    expect(w.targetPitches).toBeLessThan(100);
  });

  it("falls back to explicit priors with provenance when pitch data is missing", () => {
    const noPitch = starts().map((s) => ({ ...s, numberOfPitches: undefined }));
    const w = projectWorkloadBudget(noPitch);
    expect(w.provenance.hadPitchCounts).toBe(false);
    expect(w.provenance.sources.targetPitches).toBe("blend"); // derived from BF × prior
    expect(w.provenance.warnings.length).toBeGreaterThan(0);
  });
});

/* ------------------------------ Removal ---------------------------------- */

describe("removalHazard", () => {
  const params = buildRemovalParams(90);
  it("rises with pitch count", () => {
    const low = removalHazard({ pitchCount: 60, battersFaced: 18, outs: 15, runsAllowed: 1, baserunners: 0, timesThroughOrder: 2 }, params).hazard;
    const high = removalHazard({ pitchCount: 100, battersFaced: 26, outs: 18, runsAllowed: 1, baserunners: 0, timesThroughOrder: 3 }, params).hazard;
    expect(high).toBeGreaterThan(low);
  });
  it("rises with poor performance (runs + baserunners)", () => {
    const clean = removalHazard({ pitchCount: 80, battersFaced: 22, outs: 16, runsAllowed: 1, baserunners: 0, timesThroughOrder: 2 }, params).hazard;
    const shelled = removalHazard({ pitchCount: 80, battersFaced: 22, outs: 16, runsAllowed: 6, baserunners: 2, timesThroughOrder: 2 }, params).hazard;
    expect(shelled).toBeGreaterThan(clean);
  });
  it("is certain beyond the hard pitch cap (capped)", () => {
    const r = removalHazard({ pitchCount: 130, battersFaced: 30, outs: 24, runsAllowed: 2, baserunners: 0, timesThroughOrder: 4 }, params);
    expect(r.hazard).toBe(1);
    expect(r.reason).toBe("capped");
  });
});

/* --------------------------- Single-start events -------------------------- */

describe("simulatePitcherStart — coherent events & invariants", () => {
  const rates = estimatePitcherRates(starts());
  const workload = projectWorkloadBudget(starts());
  const params = buildRemovalParams(workload.targetPitches);

  it("is internally consistent: K ≤ outs, HR ≤ hits, totals bounded by BF", () => {
    for (let s = 0; s < 200; s++) {
      const o = simulatePitcherStart(rates, workload, params, mulberry32(s));
      expect(o.strikeouts).toBeLessThanOrEqual(o.outs); // every K is an out
      expect(o.home_runs_allowed).toBeLessThanOrEqual(o.hits_allowed); // HR is a hit
      expect(o.strikeouts + o.hits_allowed + o.pitcher_walks).toBeLessThanOrEqual(o.battersFaced);
      expect(o.pitches).toBeGreaterThan(0);
    }
  });

  it("is deterministic under a seed", () => {
    const a = simulatePitcherStart(rates, workload, params, mulberry32(42));
    const b = simulatePitcherStart(rates, workload, params, mulberry32(42));
    expect(a).toEqual(b);
  });

  it("never exceeds the complete-game ceiling (27 outs / 9 IP) even for an elite high-budget starter", () => {
    // Dominant, low-contact pitcher with an inflated pitch budget: without the
    // structural cap the removal-hazard tail runs past 9 IP (observed up to 33
    // outs / 11 IP). A starter can never record more than 27 outs.
    const elite: PitcherRates = {
      k: 0.38, bb: 0.03, hbp: 0.005, single: 0.09, double: 0.02, triple: 0.002, hr: 0.015, out: 0.458,
    };
    const bigWorkload = projectWorkloadBudget(
      starts({ numberOfPitches: 112, outs: 24, battersFaced: 28, hits: 4, baseOnBalls: 1, strikeOuts: 10, homeRuns: 0 }),
    );
    const bigParams = buildRemovalParams(bigWorkload.targetPitches);
    for (let s = 0; s < 500; s++) {
      const o = simulatePitcherStart(elite, bigWorkload, bigParams, mulberry32(s * 7 + 1));
      expect(o.outs).toBeLessThanOrEqual(MAX_START_OUTS);
    }
  });

  it("REMOVED pitcher accumulates nothing further", () => {
    const live: LiveState = {
      pitcherActive: false, pitches: 88, battersFaced: 22, outs: 16,
      strikeouts: 6, hits_allowed: 4, pitcher_walks: 2, home_runs_allowed: 1, earned_runs: 3,
    };
    const o = simulatePitcherStart(rates, workload, params, mulberry32(7), live);
    expect(o.strikeouts).toBe(6);
    expect(o.outs).toBe(16);
    expect(o.hits_allowed).toBe(4);
    expect(o.home_runs_allowed).toBe(1);
    expect(o.battersFaced).toBe(22);
  });
});

/* --------------------------- Joint simulation ----------------------------- */

describe("runPitcherJointSimulation", () => {
  const joint = buildPitcherJoint({ starts: starts(), seed: "test:pitcher", iterations: IT });

  it("produces all six prop distributions from ONE simulation", () => {
    for (const p of ["strikeouts", "pitcher_outs", "earned_runs", "hits_allowed", "pitcher_walks", "home_runs_allowed"] as const) {
      expect(joint.samples[p].length).toBe(IT);
      expect(joint.summary[p].mean).toBeGreaterThanOrEqual(0);
    }
  });

  it("is deterministic (same rates/workload/seed ⇒ identical usage + summaries)", () => {
    const a = buildPitcherJoint({ starts: starts(), seed: "det", iterations: 1500 });
    const b = buildPitcherJoint({ starts: starts(), seed: "det", iterations: 1500 });
    expect(a.usage.expectedOuts).toBe(b.usage.expectedOuts);
    expect(a.summary.strikeouts).toEqual(b.summary.strikeouts);
  });

  it("usage is plausible (no NaN; innings in a real range)", () => {
    expect(Number.isFinite(joint.usage.expectedPitches)).toBe(true);
    expect(joint.usage.expectedInnings).toBeGreaterThan(2);
    expect(joint.usage.expectedInnings).toBeLessThan(9);
    expect(joint.usage.outsExceedance.p18).toBeGreaterThanOrEqual(0);
    expect(joint.usage.outsExceedance.p18).toBeLessThanOrEqual(1);
    // No simulated start may exceed the complete-game ceiling.
    expect(Math.max(...joint.samples.pitcher_outs)).toBeLessThanOrEqual(MAX_START_OUTS);
  });

  it("strikeouts & outs are positively correlated (same outing drives both)", () => {
    const c = jointCorrelation(joint, "strikeouts", "pitcher_outs");
    expect(c).toBeGreaterThan(0.2);
  });

  it("feedback loop: a hit-prone profile shortens the outing (fewer BF)", () => {
    const clean = buildPitcherJoint({ starts: starts({ hits: 4, earnedRuns: 1 }), seed: "fb", iterations: IT });
    const shelled = buildPitcherJoint({ starts: starts({ hits: 11, earnedRuns: 6 }), seed: "fb", iterations: IT });
    expect(shelled.usage.expectedBattersFaced).toBeLessThan(clean.usage.expectedBattersFaced);
  });

  it("volume × efficiency: more BF raises expected K holding K/BF constant", () => {
    // Force a longer outing by raising the workload budget via more pitches/BF room.
    const short = buildPitcherJoint({ starts: starts({ numberOfPitches: 70, outs: 12 }), seed: "vol", iterations: IT });
    const long = buildPitcherJoint({ starts: starts({ numberOfPitches: 105, outs: 21 }), seed: "vol", iterations: IT });
    expect(long.usage.expectedBattersFaced).toBeGreaterThan(short.usage.expectedBattersFaced);
    expect(long.summary.strikeouts.mean).toBeGreaterThan(short.summary.strikeouts.mean);
  });

  it("jointProbBothMore is NOT the product of marginals", () => {
    const pK = propSimulationFromJoint(joint, "strikeouts", 5.5).probOver;
    const pH = propSimulationFromJoint(joint, "hits_allowed", 5.5).probOver;
    const jointBoth = jointProbBothMore(joint, { prop: "strikeouts", line: 5.5 }, { prop: "hits_allowed", line: 5.5 });
    // The honest joint should differ from the independence assumption.
    expect(Math.abs(jointBoth - pK * pH)).toBeGreaterThan(1e-6);
  });
});

/* ------------------------ Prop threshold evaluation ----------------------- */

describe("propSimulationFromJoint (line applied AFTER the distribution)", () => {
  const joint = buildPitcherJoint({ starts: starts(), seed: "thr", iterations: IT });

  it("outs line 17.5 MORE means 18+ outs (P from the outs distribution)", () => {
    const sim = propSimulationFromJoint(joint, "pitcher_outs", 17.5);
    const manual = joint.samples.pitcher_outs.filter((v) => v >= 18).length / IT;
    expect(sim.probOver).toBeCloseTo(manual, 2);
  });

  it("P(More)+P(Less)+P(Push) ≈ 1", () => {
    const sim = propSimulationFromJoint(joint, "strikeouts", 6.5);
    expect(sim.probOver + sim.probUnder + sim.probPush).toBeCloseTo(1, 2);
  });

  it("alternative lines reuse the SAME samples — only the threshold prob changes", () => {
    const p55 = propSimulationFromJoint(joint, "strikeouts", 5.5).probOver;
    const p65 = propSimulationFromJoint(joint, "strikeouts", 6.5).probOver;
    const p75 = propSimulationFromJoint(joint, "strikeouts", 7.5).probOver;
    expect(p55).toBeGreaterThanOrEqual(p65);
    expect(p65).toBeGreaterThanOrEqual(p75);
  });

  it("a market line never changes the projection (distribution mean is line-independent)", () => {
    const a = propSimulationFromJoint(joint, "strikeouts", 4.5);
    const b = propSimulationFromJoint(joint, "strikeouts", 9.5);
    expect(a.mean).toBe(b.mean);
  });
});

/* -------------------------------- Live ----------------------------------- */

describe("live conditioning", () => {
  it("conditions on current stats and preserves accumulated totals", () => {
    const live: LiveState = {
      pitcherActive: true, pitches: 79, battersFaced: 20, outs: 15,
      strikeouts: 3, hits_allowed: 4, pitcher_walks: 2, home_runs_allowed: 0, earned_runs: 2,
    };
    const joint = buildPitcherJoint({ starts: starts(), seed: "live", live, iterations: IT });
    // Final K must be at least the 3 already recorded.
    expect(joint.summary.strikeouts.mean).toBeGreaterThanOrEqual(3);
    expect(Math.min(...joint.samples.strikeouts)).toBeGreaterThanOrEqual(3);
    expect(Math.min(...joint.samples.pitcher_outs)).toBeGreaterThanOrEqual(15);
    expect(joint.liveBaseline?.strikeouts).toBe(3);
  });

  it("a removed pitcher's final distribution collapses on the recorded stat", () => {
    const live: LiveState = {
      pitcherActive: false, pitches: 96, battersFaced: 25, outs: 17,
      strikeouts: 8, hits_allowed: 6, pitcher_walks: 3, home_runs_allowed: 2, earned_runs: 4,
    };
    const joint = buildPitcherJoint({ starts: starts(), seed: "removed", live, iterations: 500 });
    expect(joint.summary.strikeouts.mean).toBe(8);
    expect(joint.summary.strikeouts.stdDev).toBe(0);
    expect(joint.summary.pitcher_outs.mean).toBe(17);
  });
});

/* --------------------------- normalizeRates edge -------------------------- */

describe("normalizeRates", () => {
  it("keeps positive out mass even for extreme inputs", () => {
    const r: PitcherRates = normalizeRates({ k: 0.5, bb: 0.3, hbp: 0.05, single: 0.3, double: 0.1, triple: 0.02, hr: 0.1 });
    expect(r.out).toBeGreaterThanOrEqual(0);
    const sum = r.k + r.bb + r.hbp + r.single + r.double + r.triple + r.hr + r.out;
    expect(sum).toBeCloseTo(1, 6);
  });
});
