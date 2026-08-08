/* ============================================================================
   prizepicks-opportunity@1 nodes. The graph gathers facts (pregame snapshot,
   projection, independent baseline, calibration, uncertainty, sensitivity,
   fragility, trusted scientific facts), then the terminal node runs the
   Opportunity Engine (`assessOpportunity`) and persists the assessment. The
   engine + decision veto logic are REUSED — the graph only orchestrates.

     resolveLine → loadPregameSnapshot → projection → independentBaseline →
       calibration → uncertainty → sensitivity → fragility →
       trustedScientificFacts → vetoes → opportunityDecision
   ========================================================================== */

import { z } from "zod";
import { defineNode } from "../graph/node";
import { ok, err } from "../graph/result";
import { validationError } from "../graph/errors";
import type { CanonicalLineSnapshot } from "@/lib/prizepicks/ingestion/snapshot";
import { assessOpportunity, type OpportunityInput } from "@/lib/prizepicks/opportunity/engine";
import { canonicalOpportunityAssessmentSchema } from "@/lib/prizepicks/opportunity/types";
import { independentBaseline } from "@/lib/prizepicks/opportunity/baselines";
import { computeLegGates, type LegFacts } from "@/lib/prizepicks/decision/veto";
import { DEFAULT_DECISION_POLICY } from "@/lib/prizepicks/decision/policy";
import type { CalibrationModel } from "@/lib/prizepicks/opportunity/calibration";
import {
  opportunityInputSchema,
  type OpportunityDeps, type ProjectionFacts, type SensitivityFacts, type PregameFacts, type ScientificFacts,
} from "./types";

interface LineFacts {
  lineSnapshotId: string; playerId?: number; gamePk?: number;
  market: string; line: number; capturedAt: string; verificationStatus: string;
}
const custom = <T,>() => z.object({ facts: z.custom<T>() });
const readFacts = <T,>(i: Readonly<Record<string, unknown>>, id: string) => (i[id] as { facts: T }).facts;

/** node 1 — resolve the verified line snapshot into identity facts. */
export const resolveLineNode = defineNode({
  id: "resolveLine",
  description: "Resolve the verified line snapshot into identity facts.",
  inputSchema: opportunityInputSchema,
  outputSchema: custom<LineFacts>(),
  selectInput: (i) => opportunityInputSchema.parse(i.input),
  run: async (input) => {
    const l = input.line as CanonicalLineSnapshot;
    if (!l.entryId) return err(validationError("line snapshot lacks an entry id"));
    return ok({
      facts: {
        lineSnapshotId: l.entryId, // the snapshot's stable identity
        playerId: l.playerId, gamePk: l.gamePk, market: l.marketKey, line: l.line,
        capturedAt: l.capturedAt, verificationStatus: l.verificationStatus,
      } satisfies LineFacts,
    });
  },
});

/** node 2 — load the immutable pregame snapshot facts (leakage / timing). */
export function loadPregameSnapshotNode(deps: OpportunityDeps) {
  return defineNode({
    id: "loadPregameSnapshot",
    description: "Load pregame-snapshot timing facts (no future-data leakage).",
    inputSchema: custom<LineFacts>(),
    outputSchema: custom<PregameFacts>(),
    dependsOn: ["resolveLine"],
    costCategory: "io",
    selectInput: (i) => ({ facts: readFacts<LineFacts>(i, "resolveLine") }),
    run: async (input) => ok({ facts: await deps.loadPregame(input.facts.lineSnapshotId) }),
  });
}

/** node 3 — raw projection probabilities (existing Monte-Carlo engine). */
export function projectionNode(deps: OpportunityDeps) {
  return defineNode({
    id: "projection",
    description: "Raw model projection + probabilities (never used directly as the decision prob).",
    inputSchema: custom<LineFacts>(),
    outputSchema: custom<ProjectionFacts>(),
    dependsOn: ["resolveLine"],
    costCategory: "simulation",
    selectInput: (i) => ({ facts: readFacts<LineFacts>(i, "resolveLine") }),
    run: async (input) => {
      const { market, line, playerId, gamePk } = input.facts;
      return ok({ facts: await deps.getProjection({ market, line, playerId, gamePk }) });
    },
  });
}

/** node 4 — INDEPENDENT market baseline (league prior; never the model itself). */
export const independentBaselineNode = defineNode({
  id: "independentBaseline",
  description: "Independent league-prior baseline for the market/line (model-independent).",
  inputSchema: custom<LineFacts>(),
  outputSchema: custom<ReturnType<typeof independentBaseline>>(),
  dependsOn: ["resolveLine"],
  selectInput: (i) => ({ facts: readFacts<LineFacts>(i, "resolveLine") }),
  run: async (input) => ok({ facts: independentBaseline(input.facts.market, input.facts.line) }),
});

/** node 5 — calibration model (may be UNAVAILABLE; carried as a live object). */
export function calibrationNode(deps: OpportunityDeps) {
  return defineNode({
    id: "calibration",
    description: "Fetch the calibration model (raw→calibrated); may be unavailable.",
    inputSchema: custom<LineFacts>(),
    outputSchema: custom<CalibrationModel>(),
    dependsOn: ["resolveLine", "trustedScientificFacts"],
    selectInput: (i) => ({ facts: readFacts<LineFacts>(i, "resolveLine") }),
    run: async (input, ctx) => {
      const sci = readFacts<ScientificFacts>(ctx.inputs, "trustedScientificFacts");
      return ok({ facts: await deps.getCalibration({ market: input.facts.market, modelVersion: sci.modelVersion }) });
    },
  });
}

/** node 6 — uncertainty band (from the simulation CI). */
export const uncertaintyNode = defineNode({
  id: "uncertainty",
  description: "Surface the projection uncertainty band.",
  inputSchema: custom<ProjectionFacts>(),
  outputSchema: z.object({ low: z.number(), high: z.number() }),
  dependsOn: ["projection"],
  selectInput: (i) => ({ facts: readFacts<ProjectionFacts>(i, "projection") }),
  run: async (input) => ok({ low: input.facts.uncertaintyLow, high: input.facts.uncertaintyHigh }),
});

/** node 7 — sensitivity sweep on the selected side. */
export function sensitivityNode(deps: OpportunityDeps) {
  return defineNode({
    id: "sensitivity",
    description: "Sensitivity sweep on the selected side (worst credible probability).",
    inputSchema: z.object({ line: custom<LineFacts>(), proj: custom<ProjectionFacts>() }),
    outputSchema: custom<SensitivityFacts>(),
    dependsOn: ["projection", "resolveLine"],
    costCategory: "simulation",
    selectInput: (i) => ({
      line: { facts: readFacts<LineFacts>(i, "resolveLine") },
      proj: { facts: readFacts<ProjectionFacts>(i, "projection") },
    }),
    run: async (input) => {
      const p = input.proj.facts;
      const side: "more" | "less" = p.rawProbabilityMore >= p.rawProbabilityLess ? "more" : "less";
      return ok({ facts: await deps.getSensitivity({ market: input.line.facts.market, line: input.line.facts.line, isPitcher: p.isPitcher, side }) });
    },
  });
}

/** node 8 — fragility score (from the sensitivity sweep). */
export const fragilityNode = defineNode({
  id: "fragility",
  description: "Fragility score from the sensitivity sweep.",
  inputSchema: custom<SensitivityFacts>(),
  outputSchema: z.object({ fragility: z.number(), worstCase: z.number().optional() }),
  dependsOn: ["sensitivity"],
  selectInput: (i) => ({ facts: readFacts<SensitivityFacts>(i, "sensitivity") }),
  run: async (input) => ok({ fragility: input.facts.fragility, worstCase: input.facts.worstCaseSelectedProbability }),
});

/** node 9 — trusted, server-derived scientific facts (lifecycle, drift, support). */
export function trustedScientificFactsNode(deps: OpportunityDeps) {
  return defineNode({
    id: "trustedScientificFacts",
    description: "Server-derived scientific facts (lifecycle, calibration/drift/support, status).",
    inputSchema: custom<LineFacts>(),
    outputSchema: custom<ScientificFacts>(),
    dependsOn: ["resolveLine"],
    costCategory: "io",
    selectInput: (i) => ({ facts: readFacts<LineFacts>(i, "resolveLine") }),
    run: async (input) => {
      const { market, playerId, gamePk, capturedAt } = input.facts;
      return ok({ facts: await deps.getScientificFacts({ market, playerId, gamePk, capturedAt }) });
    },
  });
}

/** node 10 — assemble facts + compute the mandatory scientific vetoes (server). */
export const vetoesNode = defineNode({
  id: "vetoes",
  description: "Assemble the opportunity input and compute the mandatory scientific vetoes.",
  inputSchema: z.object({}),
  outputSchema: z.object({ input: z.custom<OpportunityInput>(), vetoes: z.array(z.object({ code: z.string(), message: z.string() })) }),
  dependsOn: ["resolveLine", "loadPregameSnapshot", "projection", "calibration", "fragility", "trustedScientificFacts"],
  selectInput: () => ({}),
  run: async (_input, ctx) => {
    const line = readFacts<LineFacts>(ctx.inputs, "resolveLine");
    const pre = readFacts<PregameFacts>(ctx.inputs, "loadPregameSnapshot");
    const proj = readFacts<ProjectionFacts>(ctx.inputs, "projection");
    const cal = readFacts<CalibrationModel>(ctx.inputs, "calibration");
    const frag = ctx.inputs.fragility as { fragility: number; worstCase?: number };
    const sci = readFacts<ScientificFacts>(ctx.inputs, "trustedScientificFacts");

    const input: OpportunityInput = {
      lineSnapshotId: line.lineSnapshotId, playerId: line.playerId, gamePk: line.gamePk,
      market: line.market, line: line.line, isPitcher: proj.isPitcher,
      rawProbabilityMore: proj.rawProbabilityMore, rawProbabilityLess: proj.rawProbabilityLess, rawProbabilityPush: proj.rawProbabilityPush,
      projectionMean: proj.projectionMean, projectionMedian: proj.projectionMedian,
      dataQuality: proj.dataQuality, volatility: proj.volatility,
      fragility: frag.fragility, worstCaseSelectedProbability: frag.worstCase,
      uncertaintyLow: proj.uncertaintyLow, uncertaintyHigh: proj.uncertaintyHigh,
      trainingSupport: sci.trainingSupport, calibration: cal,
      marketValidationState: sci.marketValidationState, calibrationDegraded: sci.calibrationDegraded,
      featureDriftExceeded: sci.featureDriftExceeded, outsideTrainingSupport: sci.outsideTrainingSupport,
      requiredSimDependencyUnavailable: sci.requiredSimDependencyUnavailable,
      playerResolved: sci.playerResolved, gameResolved: sci.gameResolved,
      doubleheaderAmbiguous: sci.doubleheaderAmbiguous, marketSupported: sci.marketSupported, invalidLine: sci.invalidLine,
      lineupRequired: sci.lineupRequired, lineupConfirmed: sci.lineupConfirmed,
      pitcherMateriallyRelevant: sci.pitcherMateriallyRelevant, starterConfirmed: sci.starterConfirmed,
      lineAgeMinutes: sci.lineAgeMinutes, gameStarted: pre.gameStarted,
      snapshotBeforeEvent: pre.snapshotBeforeEvent, featureCutoffBeforeStart: pre.featureCutoffBeforeStart,
      pregameSnapshotExists: pre.pregameSnapshotExists, modelVersionApproved: sci.modelVersionApproved,
      modelVersion: sci.modelVersion, featureVersion: sci.featureVersion,
    };

    // Preview the mandatory scientific vetoes for the trace (authoritative copy is
    // recomputed inside the engine — deterministic, identical).
    const facts: LegFacts = {
      market: input.market, line: input.line, isPitcher: input.isPitcher,
      playerResolved: input.playerResolved, gameResolved: input.gameResolved,
      doubleheaderAmbiguous: input.doubleheaderAmbiguous, marketSupported: input.marketSupported, invalidLine: input.invalidLine,
      probabilitiesAvailable: true, probabilityMore: input.rawProbabilityMore, probabilityLess: input.rawProbabilityLess,
      dataQualityScore: input.dataQuality, fragilityScore: input.fragility, volatilityScore: input.volatility,
      lineupRequired: input.lineupRequired, lineupConfirmed: input.lineupConfirmed,
      pitcherMateriallyRelevant: input.pitcherMateriallyRelevant, starterConfirmed: input.starterConfirmed,
      lineAgeMinutes: input.lineAgeMinutes, gameStarted: input.gameStarted,
      snapshotBeforeEvent: input.snapshotBeforeEvent, featureCutoffBeforeStart: input.featureCutoffBeforeStart,
      pregameSnapshotExists: input.pregameSnapshotExists, modelVersionApproved: input.modelVersionApproved,
      marketValidationState: input.marketValidationState, calibrationDegraded: input.calibrationDegraded,
      featureDriftExceeded: input.featureDriftExceeded, outsideTrainingSupport: input.outsideTrainingSupport,
      requiredSimDependencyUnavailable: input.requiredSimDependencyUnavailable,
    };
    const gates = computeLegGates(facts, DEFAULT_DECISION_POLICY);
    return ok({ input, vetoes: gates.vetoes.map((v) => ({ code: v.code, message: v.message })) });
  },
});

/** node 11 — run the Opportunity Engine and persist the immutable assessment. */
export function opportunityDecisionNode(deps: OpportunityDeps) {
  return defineNode({
    id: "opportunityDecision",
    description: "Run the Opportunity Engine (calibrated prob + independent edge) and persist.",
    inputSchema: z.object({ input: z.custom<OpportunityInput>() }),
    outputSchema: canonicalOpportunityAssessmentSchema,
    dependsOn: ["vetoes"],
    costCategory: "io",
    selectInput: (i) => ({ input: (i.vetoes as { input: OpportunityInput }).input }),
    run: async (input) => {
      const assessment = assessOpportunity(input.input);
      await deps.store.persist(assessment);
      return ok(assessment);
    },
  });
}
