/* The versioned, conservative research policy. These are PROVISIONAL research
   thresholds — NOT proven-profitability thresholds — and must not be loosened
   merely to produce more BET decisions. The exact version is stored in every
   decision record. */

import type { DecisionPolicy } from "./types";

export const DEFAULT_DECISION_POLICY: DecisionPolicy = {
  id: "diamond-edge-conservative",
  version: "1.0.0",
  effectiveFrom: "2026-01-01T00:00:00Z",

  minimumSelectedSideProbability: 0.62,
  minimumConfidence: 80,
  minimumDataQuality: 85,
  maximumFragility: 30,
  maximumVolatility: 85,

  minimumEntryExpectedReturn: 1.05,
  maximumLineAgeMinutes: 15,

  requireConfirmedPlayer: true,
  requireConfirmedGame: true,
  requireConfirmedLineupForHitters: true,
  requireConfirmedPitcher: true,
  requirePayoutTable: true,
  requirePregameSnapshot: true,
  requireNoCriticalWarnings: true,

  minimumForwardSampleByMarket: 100,
  minimumCalibrationGrade: "PROVISIONAL",

  source: "application-config",
  createdAt: "2026-01-01T00:00:00Z",
};
