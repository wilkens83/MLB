/* ============================================================================
   Player Picks — typed domain for the "one player → every supported prop, ranked"
   screening feature. This is NOT a new prediction engine: every number here is
   produced by the EXISTING engine (`runAnalysis` → projection + Monte Carlo +
   ensemble + analytics). This layer only fans out, screens, and ranks.

   Two hard product rules encoded here:
     1. A market line is only a THRESHOLD — it never changes a projection.
     2. When there is no active line, the prop is `projection_only`: a projection
        is shown but NO probability/edge/recommendation is invented.
   ========================================================================== */

import { z } from "zod";
import type { DisagreementSeverity } from "@/lib/models";

/** Picks-level screening decision. Distinct from the firm calibrated decision on
 *  the Full Analysis page — this is a discovery screen, labeled as such. */
export type PickDecision =
  | "qualified"
  | "watch"
  | "rejected"
  | "unavailable"
  | "projection_only";

export type Side = "more" | "less";

/** Lightweight, CI-based fragility proxy (the full sensitivity sweep lives on the
 *  Full Analysis page — this avoids re-simulating every prop). */
export type FragilityLevel = "LOW" | "MODERATE" | "HIGH" | "EXTREME";

/** One recent-performance window, sourced from the existing analytics engine. */
export interface WindowStat {
  window: number | "season";
  average: number;
  median: number;
  /** HISTORICAL hit rate vs the current line — NOT the model probability. */
  hitRate?: number;
  sampleSize: number;
}

/** Alternative-line analysis: SAME distribution, different threshold. */
export interface AltLineAnalysis {
  line: number;
  projectionType?: string;
  probMore: number;
  probLess: number;
  /** Deterministic label: highest raw prob / standard / aggressive / avoid. */
  label: "highest" | "standard" | "aggressive" | "avoid";
}

/** Existing model evidence exposed per candidate (never recomputed here). */
export interface PickModelEvidence {
  marginalProb?: number;
  paProb?: number;
  baselineProb?: number;
  ensembleProb?: number;
  disagreement: DisagreementSeverity | "unknown";
  dataQuality: number;
  fragility: FragilityLevel;
  /** Honest note: picks uses the raw simulation probability, not the calibrated
   *  decision-engine probability (which is on the Full Analysis page). */
  calibration: "raw" | "limited";
}

export interface PickContext {
  opponentName?: string;
  probablePitcherName?: string;
  venueName?: string;
  homeAway?: "home" | "away";
  lineupConfirmed?: boolean;
  starterConfirmed?: boolean;
}

/** One analyzed prop for the selected player. */
export interface PlayerPickCandidate {
  playerId: number;
  gamePk?: number;

  propKey: string;
  propLabel: string;
  category: "pitcher" | "batter";

  /** The active threshold (present only in line mode). */
  line?: number;
  projectionType?: string;

  /** Model projection (lambda) — line-independent, always present. */
  projection: number;

  preferredSide?: Side;
  probMore?: number;
  probLess?: number;
  probPush?: number;

  recent: {
    l5?: WindowStat;
    l10?: WindowStat;
    l20?: WindowStat;
    season?: WindowStat;
  };

  model: PickModelEvidence;
  context: PickContext;

  altLines: AltLineAnalysis[];

  decision: PickDecision;
  /** Experimental screening score (0–100), from the existing ranking layer. */
  score: number;
  reasons: string[];
  risks: string[];

  /** Deep link into the EXISTING analysis page (no second analysis page). */
  fullAnalysisHref: string;

  warnings: { code: string; severity: "info" | "warn" | "high" }[];
}

export interface PicksPlayer {
  id: number;
  name: string;
  team?: string;
  teamId?: number;
  position?: string;
  isPitcher: boolean;
}

export interface PicksGame {
  gamePk?: number;
  opponentName?: string;
  gameStartTime?: string;
  resolved: boolean;
  reason?: string;
}

export interface PlayerPicksResult {
  player: PicksPlayer;
  game: PicksGame;
  /** Up to 3 strongest QUALIFIED candidates; empty ⇒ noStrongPick. */
  topPicks: PlayerPickCandidate[];
  /** Every line-mode prop (qualified→unavailable), ranked. */
  allProps: PlayerPickCandidate[];
  /** Props with no active line — projection shown, never a fabricated pick. */
  projectionOnly: PlayerPickCandidate[];
  noStrongPick: boolean;
  generatedAt: string;
  provenance: {
    modelVersion: string;
    picksPolicyVersion: string;
    season: number;
    date: string;
    lineSource: "imported" | "none" | "mixed";
  };
  error?: string;
}

/** A user-supplied (imported) PrizePicks line for a market, passed to the
 *  server. The board store is client-side, so lines are provided by the caller —
 *  the server never fabricates a market. */
export interface ImportedLine {
  marketKey: string;
  line: number;
  projectionType?: string;
  alternativeLines?: { line: number; projectionType?: string }[];
  capturedAt?: string;
}

export const importedLineSchema = z.object({
  marketKey: z.string().min(1),
  line: z.number().finite(),
  projectionType: z.string().optional(),
  alternativeLines: z
    .array(z.object({ line: z.number().finite(), projectionType: z.string().optional() }))
    .optional(),
  capturedAt: z.string().optional(),
});

export const PICKS_POLICY_VERSION = "picks-1.0.0";
