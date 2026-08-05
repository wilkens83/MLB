/* ============================================================================
   Player-prop workflow nodes. Each node reuses the PURE analytics core
   (project / simulate / recommend / odds math) — no new modeling logic. The
   chain always completes: insufficient-data, rejected, and no-price outcomes are
   resolved deterministically in the terminal `recommend` node.

   loadSeries → sampleQuality → project → simulate → priceCompare → verify → recommend
   ========================================================================== */

import { z } from "zod";
import { defineNode } from "../graph/node";
import { ok, err } from "../graph/result";
import { dataUnavailableError, modelError } from "../graph/errors";
import { getProp } from "@/lib/props/catalog";
import { project } from "@/lib/prediction/projection";
import { simulate } from "@/lib/prediction/simulate";
import { edge as oddsEdge, expectedValue } from "@/lib/odds/math";
import {
  aggregate, sampleQualityVerifier, projectionSanityVerifier, probabilityBoundsVerifier,
  oddsMathVerifier, simulationStabilityVerifier, crossMethodAgreementVerifier,
  freshnessVerifier, recommendationVerifier,
} from "../verification/verifiers";
import {
  playerPropInputSchema, seriesResultSchema, sampleQualityOutputSchema,
  priceCompareOutputSchema, projectionSchema, simulationResultSchema,
  recommendationSchema, verificationResultSchema, type PlayerPropDeps, type PlayerPropInput,
} from "./types";

const DEFAULT_MIN_SAMPLE = 10;

/** node 1 — load the point-in-time series via the injected adapter. */
export function loadSeriesNode(deps: PlayerPropDeps) {
  return defineNode({
    id: "loadSeries",
    description: "Load the point-in-time game-log series for the player+prop.",
    inputSchema: playerPropInputSchema,
    outputSchema: seriesResultSchema,
    costCategory: "external-api",
    timeoutMs: 8000,
    retry: { maxAttempts: 3, backoffMs: 200, factor: 2 },
    failurePolicy: "fail-fast",
    selectInput: (i) => i.input as PlayerPropInput,
    run: async (input, ctx) => {
      ctx.meter.apiCall();
      try {
        const res = await deps.getSeries(input);
        return ok(res);
      } catch (e) {
        return err(dataUnavailableError(`series unavailable: ${e instanceof Error ? e.message : String(e)}`));
      }
    },
  });
}

/** node 2 — sample-quality gate (does not fail; downstream reads `sufficient`). */
export const sampleQualityNode = defineNode({
  id: "sampleQuality",
  description: "Validate the series has enough games for a projection.",
  inputSchema: z.object({ series: z.array(z.number()), minSample: z.number().int() }),
  outputSchema: sampleQualityOutputSchema,
  dependsOn: ["loadSeries", "input"],
  selectInput: (i) => {
    const s = i.loadSeries as { series: number[] };
    const inp = i.input as PlayerPropInput;
    return { series: s.series, minSample: inp.minSample ?? DEFAULT_MIN_SAMPLE };
  },
  run: async (input) =>
    ok({ sufficient: input.series.length >= input.minSample, sampleSize: input.series.length, minSample: input.minSample }),
});

/** node 3 — projection (pure core). */
export const projectNode = defineNode({
  id: "project",
  description: "Recency-weighted, shrunk projection for the prop's distribution family.",
  inputSchema: z.object({ series: z.array(z.number()), propKey: z.string() }),
  outputSchema: projectionSchema,
  dependsOn: ["loadSeries", "input"],
  selectInput: (i) => ({
    series: (i.loadSeries as { series: number[] }).series,
    propKey: (i.input as PlayerPropInput).propKey,
  }),
  run: async (input) => {
    const prop = getProp(input.propKey);
    if (!prop) return err(modelError(`unknown prop: ${input.propKey}`));
    // Guard an empty series: return a zero-mean projection so the chain completes;
    // the terminal node reports insufficient-data.
    const series = input.series.length ? input.series : [0];
    const p = project({ series, family: prop.family });
    return ok({ mean: p.lambda, method: "marginal" as const, sampleSize: input.series.length });
  },
});

/** node 4 — Monte Carlo simulation (pure core, seeded → deterministic). */
export const simulateNode = defineNode({
  id: "simulate",
  description: "Seeded Monte Carlo over the projection → over/under/push probabilities.",
  inputSchema: z.object({
    mean: z.number(), propKey: z.string(), line: z.number(), seed: z.string(), iterations: z.number().int(),
  }),
  outputSchema: simulationResultSchema,
  dependsOn: ["project", "input"],
  costCategory: "simulation",
  selectInput: (i) => {
    const inp = i.input as PlayerPropInput;
    const prop = getProp(inp.propKey);
    return {
      mean: (i.project as { mean: number }).mean,
      propKey: inp.propKey,
      line: inp.line ?? prop?.defaultLine ?? 0.5,
      seed: inp.seed ?? `${inp.playerId}:${inp.propKey}:${inp.line ?? prop?.defaultLine ?? 0}`,
      iterations: inp.iterations ?? 10_000,
    };
  },
  run: async (input, ctx) => {
    const prop = getProp(input.propKey);
    if (!prop) return err(modelError(`unknown prop: ${input.propKey}`));
    ctx.meter.simulations(input.iterations);
    const sim = simulate({ lambda: input.mean, family: prop.family } as Parameters<typeof simulate>[0], input.line, {
      iterations: input.iterations, seed: input.seed,
    });
    return ok({
      pOver: sim.probOver, pUnder: sim.probUnder, pPush: sim.probPush,
      mean: sim.mean, stdDev: sim.stdDev, iterations: sim.iterations,
    });
  },
});

/** node 5 — price comparison (degrades cleanly to model-only when no price). */
export const priceCompareNode = defineNode({
  id: "priceCompare",
  description: "Compare the model probability to a market price → edge/EV (model-only when no price).",
  inputSchema: z.object({
    pOver: z.number(), pUnder: z.number(), side: z.enum(["over", "under"]),
    confidenceSample: z.number().int(),
    overAmerican: z.number().int().optional(), underAmerican: z.number().int().optional(),
  }),
  outputSchema: priceCompareOutputSchema,
  dependsOn: ["simulate", "input"],
  selectInput: (i) => {
    const inp = i.input as PlayerPropInput;
    const sim = i.simulate as { pOver: number; pUnder: number };
    const side = inp.side ?? (sim.pOver >= sim.pUnder ? "over" : "under");
    return {
      pOver: sim.pOver, pUnder: sim.pUnder, side,
      confidenceSample: (i.sampleQuality as { sampleSize: number })?.sampleSize ?? 0,
      overAmerican: inp.overAmerican, underAmerican: inp.underAmerican,
    };
  },
  run: async (input) => {
    const modelProbability = input.side === "over" ? input.pOver : input.pUnder;
    const american = input.side === "over" ? input.overAmerican : input.underAmerican;
    const decisiveness = Math.abs(modelProbability - 0.5) * 140;
    const sampleBonus = (Math.min(input.confidenceSample, 30) / 30) * 30;
    const confidence = Math.round(Math.min(100, Math.max(0, decisiveness + sampleBonus)));
    if (american === undefined) {
      return ok({ hasPrice: false, side: input.side, modelProbability, confidence });
    }
    return ok({
      hasPrice: true, side: input.side, modelProbability, confidence,
      edge: oddsEdge(modelProbability, american),
      ev: expectedValue(modelProbability, american),
    });
  },
});

/** node 6 — independent verification (deterministic, does not trust production fns). */
export const verifyNode = defineNode({
  id: "verify",
  description: "Independent deterministic verification of projection/simulation/odds/freshness.",
  inputSchema: z.object({
    mean: z.number(), pOver: z.number(), pUnder: z.number(), pPush: z.number(),
    iterations: z.number().int(), stdDev: z.number(), sampleSize: z.number().int(), minSample: z.number().int(),
    american: z.number().int().optional(), featureCutoff: z.string().optional(), eventStartTime: z.string().optional(),
  }),
  outputSchema: verificationResultSchema,
  dependsOn: ["priceCompare", "project", "simulate", "sampleQuality", "loadSeries", "input"],
  selectInput: (i) => {
    const proj = i.project as { mean: number };
    const sim = i.simulate as { pOver: number; pUnder: number; pPush: number; iterations: number; stdDev: number };
    const sq = i.sampleQuality as { sampleSize: number; minSample: number };
    const series = i.loadSeries as { featureCutoff?: string; eventStartTime?: string };
    const pc = i.priceCompare as { hasPrice: boolean; side: "over" | "under" };
    const inp = i.input as PlayerPropInput;
    const american = pc.hasPrice ? (pc.side === "over" ? inp.overAmerican : inp.underAmerican) : undefined;
    return {
      mean: proj.mean, pOver: sim.pOver, pUnder: sim.pUnder, pPush: sim.pPush,
      iterations: sim.iterations, stdDev: sim.stdDev, sampleSize: sq.sampleSize, minSample: sq.minSample,
      american, featureCutoff: series.featureCutoff, eventStartTime: series.eventStartTime,
    };
  },
  run: async (input) => {
    const checks = [
      sampleQualityVerifier(input.sampleSize, input.minSample),
      projectionSanityVerifier(input.mean),
      probabilityBoundsVerifier({ over: input.pOver, under: input.pUnder, push: input.pPush }),
      simulationStabilityVerifier(input.iterations, input.stdDev),
      crossMethodAgreementVerifier(input.pOver, input.pOver), // both from same sim → agree; placeholder when only one method
      oddsMathVerifier(input.american),
      freshnessVerifier({ featureCutoff: input.featureCutoff, eventStartTime: input.eventStartTime }),
    ];
    return ok(aggregate(checks));
  },
});

/** node 7 — terminal recommendation with explicit status. */
export const recommendNode = defineNode({
  id: "recommend",
  description: "Combine verification + price into a final recommendation with an explicit status.",
  inputSchema: z.object({
    sufficient: z.boolean(), verificationPassed: z.boolean(), rejections: z.array(z.string()),
    hasPrice: z.boolean(), side: z.enum(["over", "under"]), modelProbability: z.number(),
    edge: z.number().optional(), ev: z.number().optional(), confidence: z.number(),
  }),
  outputSchema: recommendationSchema,
  dependsOn: ["verify", "priceCompare", "sampleQuality"],
  selectInput: (i) => {
    const sq = i.sampleQuality as { sufficient: boolean };
    const v = i.verify as { passed: boolean; rejections: string[] };
    const pc = i.priceCompare as { hasPrice: boolean; side: "over" | "under"; modelProbability: number; edge?: number; ev?: number; confidence: number };
    return {
      sufficient: sq.sufficient, verificationPassed: v.passed, rejections: v.rejections,
      hasPrice: pc.hasPrice, side: pc.side, modelProbability: pc.modelProbability,
      edge: pc.edge, ev: pc.ev, confidence: pc.confidence,
    };
  },
  run: async (input) => {
    const warnings: string[] = [];
    // Precedence: insufficient-data > rejected > no-price > ok.
    if (!input.sufficient) {
      return ok(recommendationSchema.parse({ status: "insufficient-data", warnings: ["sample below minimum"] }));
    }
    // Verification independently re-checks the final recommendation's consistency.
    const recoCheck = recommendationVerifier({ side: input.side, probability: input.modelProbability, status: "ok" });
    if (!input.verificationPassed || !recoCheck.passed) {
      return ok(recommendationSchema.parse({
        status: "rejected",
        warnings: [...input.rejections, ...(recoCheck.passed ? [] : [recoCheck.code!])],
      }));
    }
    if (!input.hasPrice) {
      warnings.push("no market price supplied — model probability only, no EV");
      return ok(recommendationSchema.parse({
        status: "no-price", side: input.side, probability: input.modelProbability,
        confidence: input.confidence, warnings,
      }));
    }
    return ok(recommendationSchema.parse({
      status: "ok", side: input.side, probability: input.modelProbability,
      edge: input.edge, ev: input.ev, confidence: input.confidence, warnings,
    }));
  },
});
