/* ============================================================================
   Analytics connection (server). Turns a resolved board entry into a
   CandidateEvaluation by calling the EXISTING engine (runAnalysis) unchanged.

   The imported PrizePicks line is passed only as the threshold. It never enters
   the projection — the model's λ is computed from real MLB/Statcast data exactly
   as before. "More" == over the line, "Less" == under, "Push" == exactly on it.
   ========================================================================== */

import { runAnalysis } from "@/lib/mlb/analysis";
import { round, clamp } from "@/lib/utils";
import { marketByCanonical } from "./market-map";
import type { CandidateEvaluation } from "./types";

export interface EvaluateInput {
  entryId: string;
  mlbPlayerId: number;
  marketKey: string;
  line: number;
  gamePk?: number;
  pregame?: boolean;
}

export async function evaluateEntry(input: EvaluateInput): Promise<CandidateEvaluation | null> {
  const market = marketByCanonical(input.marketKey);
  if (!market || !market.supported) return null;

  const payload = await runAnalysis({
    playerId: input.mlbPlayerId,
    propKey: input.marketKey,
    line: input.line,
    side: "over",
  });
  const a = payload.analysis;
  if (!a) return null;

  const probMore = a.simulation.probOver;
  const probLess = a.simulation.probUnder;
  const probPush = a.simulation.probPush;

  // Model agreement: how consistent the model's directional lean is with recent
  // form (L10 over-rate). 1 = perfectly consistent.
  const l10 = a.analytics.hitRates.find((h) => String(h.window) === "10")?.rate ?? probMore;
  const modelAgreement = clamp(1 - Math.abs(probMore - l10), 0, 1);

  const hr = (w: string) => a.analytics.hitRates.find((h) => String(h.window) === w)?.rate ?? 0;

  return {
    entryId: input.entryId,
    mlbPlayerId: input.mlbPlayerId,
    gamePk: input.gamePk,
    marketKey: input.marketKey,
    line: input.line,
    projection: round(a.projection.lambda, 2),
    median: a.simulation.median,
    probMore: round(probMore, 4),
    probLess: round(probLess, 4),
    probPush: round(probPush, 4),
    projectionDiff: round(a.projection.lambda - input.line, 2),
    hitRates: {
      l5: round(hr("5"), 3),
      l10: round(hr("10"), 3),
      l20: round(hr("20"), 3),
      season: round(hr("season"), 3),
    },
    dataQuality: payload.dataQuality?.score ?? 0,
    modelAgreement: round(modelAgreement, 3),
    sampleSize: payload.meta.sampleSize,
    warnings: payload.warnings.map((w) => ({ code: w.code, severity: w.severity })),
    modelVersion: payload.provenance?.modelVersion ?? "unknown",
    calculatedAt: new Date().toISOString(),
    pregame: input.pregame ?? true,
  };
}
