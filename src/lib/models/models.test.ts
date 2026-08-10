import { describe, it, expect } from "bun:test";
import { computeModelEnsemble, buildEnsemble, computeDisagreement, baselineModel } from "./index";
import { project } from "@/lib/prediction/projection";
import { simulate } from "@/lib/prediction/simulate";
import type { ModelOutput } from "./types";

const SERIES = [10, 6, 7, 5, 9, 8, 11, 7, 6, 9];

function marginalSim(line: number) {
  const proj = project({ series: SERIES, family: "negbinom" });
  return simulate({ ...proj, lambda: proj.shrunkMean, contextMultiplier: 1 }, line, { seed: "k:5.5" });
}

function model(id: ModelOutput["id"], probOver: number, projection: number): ModelOutput {
  return {
    id, modelVersion: "t", projection, probOver, probUnder: 1 - probOver, probPush: 0,
    sampleSize: 10, warnings: [], metadata: {},
  };
}

describe("baseline model (control) invariants", () => {
  it("produces finite, in-range probabilities that sum to 1 and a non-negative projection", () => {
    const m = baselineModel({ series: SERIES, family: "negbinom", line: 5.5, seed: "s" });
    expect(m.id).toBe("baseline");
    expect(m.probOver).toBeGreaterThanOrEqual(0);
    expect(m.probOver).toBeLessThanOrEqual(1);
    expect(m.probOver + m.probUnder + m.probPush).toBeCloseTo(1, 3);
    expect(m.projection).toBeGreaterThanOrEqual(0);
    expect(m.metadata.contextApplied).toBe(false); // control applies no context
  });

  it("is deterministic for the same series/line/seed (reproducible)", () => {
    const a = baselineModel({ series: SERIES, family: "negbinom", line: 5.5, seed: "s" });
    const b = baselineModel({ series: SERIES, family: "negbinom", line: 5.5, seed: "s" });
    expect(a.probOver).toBe(b.probOver);
    expect(a.projection).toBe(b.projection);
  });

  it("warns on a thin sample rather than pretending confidence", () => {
    const m = baselineModel({ series: [3, 4], family: "poisson", line: 0.5, seed: "s" });
    expect(m.warnings.join(" ")).toMatch(/3 games|unstable/i);
  });
});

describe("ensemble (weighted, renormalized, versioned)", () => {
  it("renormalizes weights over PRESENT models (a missing model is never fabricated)", () => {
    // Only marginal + baseline present (no PA). Weights 0.35 + 0.15 → renormalized 0.7 / 0.3.
    const ens = buildEnsemble([model("marginal", 0.6, 6), model("baseline", 0.5, 5)]);
    expect(ens.weights.marginal).toBeCloseTo(0.7, 4);
    expect(ens.weights.baseline).toBeCloseTo(0.3, 4);
    expect(ens.contributions.length).toBe(2);
    // weighted probOver = 0.7*0.6 + 0.3*0.5 = 0.57
    expect(ens.rawProbOver).toBeCloseTo(0.57, 4);
    expect(ens.version).toBe("1.0.0");
  });

  it("keeps the three probabilities summing to 1", () => {
    const ens = buildEnsemble([
      { ...model("pa", 0.65, 7), probPush: 0.02, probUnder: 0.33 },
      model("marginal", 0.6, 6),
      model("baseline", 0.55, 5.5),
    ]);
    expect(ens.rawProbOver + ens.rawProbUnder + ens.rawProbPush).toBeCloseTo(1, 3);
  });

  it("flags when only one model is available", () => {
    const ens = buildEnsemble([model("marginal", 0.6, 6)]);
    expect(ens.weights.marginal).toBe(1);
    expect(ens.warnings.join(" ")).toMatch(/only the marginal/);
  });

  it("degrades safely with no models", () => {
    const ens = buildEnsemble([]);
    expect(ens.rawProbOver).toBe(0);
    expect(ens.warnings.join(" ")).toMatch(/no models/);
  });
});

describe("model disagreement (deterministic severity)", () => {
  it("reports LOW disagreement for tightly-clustered probabilities", () => {
    const d = computeDisagreement([model("pa", 0.61, 6.2), model("marginal", 0.63, 6.4), model("baseline", 0.59, 6.0)]);
    expect(d.severity).toBe("low");
    expect(d.probabilityRange).toBeCloseTo(0.04, 4);
    expect(d.modelCount).toBe(3);
  });

  it("reports HIGH disagreement for widely-spread probabilities", () => {
    const d = computeDisagreement([model("pa", 0.43, 5), model("marginal", 0.78, 8), model("baseline", 0.59, 6)]);
    expect(d.severity).toBe("high");
    expect(d.probabilityRange).toBeCloseTo(0.35, 4);
  });

  it("a single model cannot disagree with itself", () => {
    const d = computeDisagreement([model("marginal", 0.6, 6)]);
    expect(d.severity).toBe("low");
    expect(d.probabilityRange).toBe(0);
    expect(d.modelCount).toBe(1);
  });
});

describe("computeModelEnsemble end-to-end (reuses engine sims)", () => {
  it("builds marginal + baseline (no PA) with ensemble + disagreement and holds invariants", () => {
    const res = computeModelEnsemble({
      series: SERIES, family: "negbinom", line: 5.5, seed: "k:5.5",
      marginalSim: marginalSim(5.5), modelVersion: "2.0.0-statcast",
    });
    expect(res.models.map((m) => m.id).sort()).toEqual(["baseline", "marginal"]);
    expect(res.ensemble.rawProbOver + res.ensemble.rawProbUnder + res.ensemble.rawProbPush).toBeCloseTo(1, 3);
    expect(res.ensemble.projection).toBeGreaterThanOrEqual(0);
    expect(["low", "medium", "high"]).toContain(res.disagreement.severity);
    for (const m of res.models) {
      expect(m.probOver).toBeGreaterThanOrEqual(0);
      expect(m.probOver).toBeLessThanOrEqual(1);
    }
  });

  it("includes the PA model (leading) when a PA simulation is supplied", () => {
    const res = computeModelEnsemble({
      series: SERIES, family: "poisson", line: 0.5, seed: "h:0.5",
      marginalSim: marginalSim(0.5), paSim: marginalSim(0.5), modelVersion: "2.0.0-statcast",
    });
    expect(res.models[0].id).toBe("pa");
    expect(res.models.map((m) => m.id).sort()).toEqual(["baseline", "marginal", "pa"]);
    // pa weight (0.5) is the largest effective weight.
    expect(res.ensemble.weights.pa).toBeGreaterThan(res.ensemble.weights.marginal ?? 0);
  });
});
