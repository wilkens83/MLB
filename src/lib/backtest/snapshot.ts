/* ============================================================================
   Canonical IMMUTABLE prediction record + temporal-leakage guard.

   A pregame prediction is frozen the moment it is written. A new line, lineup,
   weather, model version, or projection NEVER mutates an existing snapshot — it
   creates a NEW one. The leakage guard enforces the core point-in-time rule:

       dataTimestamp <= predictionTimestamp < gameStartTime

   so a historical forecast can never have consumed future information.
   ========================================================================== */

import type { ModelOutput, EnsembleOutput, ModelDisagreement } from "@/lib/models";

export interface PredictionMarketSnapshot {
  source: string;
  line: number;
  overOdds?: number;
  underOdds?: number;
  capturedAt: number;
}

export interface PredictionProvenanceLite {
  seed: string;
  /** Latest data timestamp that fed the projection (epoch ms). */
  dataTimestamp: number;
  sources: { name: string; available: boolean; fetchedAt?: number }[];
}

/** An immutable, point-in-time prediction record. */
export interface PredictionSnapshot {
  predictionId: string;
  createdAt: number;
  predictionTimestamp: number;

  gamePk: number;
  gameStartTime: number;

  playerId: number;
  propKey: string;
  line: number;

  modelVersion: string;
  ensembleVersion: string;
  graphVersion?: string;
  calibrationVersion?: string;

  models: Record<string, ModelOutput>;
  ensemble: EnsembleOutput;
  modelDisagreement: ModelDisagreement;

  rawProbOver: number;
  rawProbUnder: number;
  rawProbPush: number;

  calibratedProbOver?: number;
  calibratedProbUnder?: number;

  projection: number;
  dataQuality: number; // 0..100

  provenance: PredictionProvenanceLite;
  marketSnapshot?: PredictionMarketSnapshot;
}

export interface LeakageCheck {
  ok: boolean;
  reason?: string;
}

/**
 * The point-in-time invariant for a prediction: every input timestamp is at or
 * before the prediction time, which is strictly before the game starts.
 */
export function checkNoLeakage(input: {
  dataTimestamp: number;
  predictionTimestamp: number;
  gameStartTime: number;
}): LeakageCheck {
  const { dataTimestamp, predictionTimestamp, gameStartTime } = input;
  if (!(dataTimestamp <= predictionTimestamp)) {
    return { ok: false, reason: "dataTimestamp is after predictionTimestamp (future data leaked into the forecast)" };
  }
  if (!(predictionTimestamp < gameStartTime)) {
    return { ok: false, reason: "predictionTimestamp is at or after gameStartTime (not a pregame forecast)" };
  }
  return { ok: true };
}

/** Convenience: validate a full snapshot's timing. */
export function snapshotIsLeakageFree(s: PredictionSnapshot): LeakageCheck {
  return checkNoLeakage({
    dataTimestamp: s.provenance.dataTimestamp,
    predictionTimestamp: s.predictionTimestamp,
    gameStartTime: s.gameStartTime,
  });
}

/**
 * Freeze a snapshot so it can never be mutated in place. A correction must create
 * a NEW snapshot (a new predictionId), never edit an existing one.
 */
export function freezeSnapshot(s: PredictionSnapshot): Readonly<PredictionSnapshot> {
  return Object.freeze({ ...s });
}
