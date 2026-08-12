/* ============================================================================
   Player Picks decision + explanation — a DEDICATED, deterministic screening
   layer. It maps the existing model signals (preferred-side probability, data
   quality, model disagreement, fragility proxy, warnings) to one of
   qualified / watch / rejected / unavailable, and builds a structured, non-LLM
   explanation (positive evidence + risks). State precedence and the fragility
   gate guarantee that a high raw probability can never buy its way past a fragile
   or unresolved candidate.

   This is a discovery screen, NOT the firm calibrated decision (that lives on the
   Full Analysis / decision page). Labeled as such throughout the UI.
   ========================================================================== */

import type { DisagreementSeverity } from "@/lib/models";
import type { PredictionWarning } from "@/lib/domain/models";
import type { FragilityLevel, PickDecision, ProjectionStatus, Side, WindowStat } from "./types";

export interface PicksPolicy {
  /** Preferred-side probability needed to WATCH. */
  minProbWatch: number;
  /** Preferred-side probability needed to QUALIFY. */
  minProbQualified: number;
  /** Data quality (0–100) needed to QUALIFY. */
  minDataQualityQualified: number;
}

export const DEFAULT_PICKS_POLICY: PicksPolicy = {
  minProbWatch: 0.52,
  minProbQualified: 0.58,
  minDataQualityQualified: 55,
};

/** Warnings that make a candidate structurally unusable (not just weak). */
const CRITICAL_WARNINGS = new Set([
  "unresolved_player", "game_unresolved", "post_start", "conflicting_game", "no_series_data",
]);

export interface DecideInput {
  resolved: boolean; // player + game resolved
  marketSupported: boolean;
  hasLine: boolean;
  probMore?: number;
  probLess?: number;
  dataQuality: number;
  disagreement: DisagreementSeverity | "unknown";
  fragility: FragilityLevel;
  warnings: { code: string; severity: "info" | "warn" | "high" }[];
}

export interface DecideOutput {
  decision: PickDecision;
  preferredSide?: Side;
  reasonCodes: string[];
}

/**
 * Deterministic screening decision. Precedence: UNAVAILABLE > (fragility/critical
 * gates) > QUALIFIED > WATCH > REJECTED. Projection-only when there is no line.
 */
export function decidePick(input: DecideInput, policy: PicksPolicy = DEFAULT_PICKS_POLICY): DecideOutput {
  const reasonCodes: string[] = [];

  const hasCritical = input.warnings.some((w) => w.severity === "high" && CRITICAL_WARNINGS.has(w.code));
  if (!input.resolved || hasCritical) {
    return { decision: "unavailable", reasonCodes: ["UNRESOLVED_OR_CRITICAL"] };
  }
  if (!input.marketSupported) {
    return { decision: "unavailable", reasonCodes: ["MARKET_UNSUPPORTED"] };
  }
  if (!input.hasLine) {
    return { decision: "projection_only", reasonCodes: ["NO_ACTIVE_LINE"] };
  }

  const probMore = input.probMore ?? 0;
  const probLess = input.probLess ?? 0;
  const preferredSide: Side = probMore >= probLess ? "more" : "less";
  const preferred = Math.max(probMore, probLess);

  // Fragility gate — a fragile projection can never qualify regardless of prob.
  if (input.fragility === "EXTREME") {
    return { decision: "rejected", preferredSide, reasonCodes: ["FRAGILITY_EXTREME"] };
  }

  const hasHighWarning = input.warnings.some((w) => w.severity === "high");
  const fragilityOkForQualify = input.fragility === "LOW" || input.fragility === "MODERATE";
  const disagreementOkForQualify = input.disagreement !== "high";

  if (
    preferred >= policy.minProbQualified &&
    input.dataQuality >= policy.minDataQualityQualified &&
    fragilityOkForQualify &&
    disagreementOkForQualify &&
    !hasHighWarning
  ) {
    reasonCodes.push("QUALIFIED");
    return { decision: "qualified", preferredSide, reasonCodes };
  }

  if (preferred >= policy.minProbWatch) {
    if (preferred < policy.minProbQualified) reasonCodes.push("PROB_BELOW_QUALIFY");
    if (input.dataQuality < policy.minDataQualityQualified) reasonCodes.push("DATA_QUALITY_BELOW_MIN");
    if (input.fragility === "HIGH") reasonCodes.push("FRAGILITY_HIGH");
    if (input.disagreement === "high") reasonCodes.push("DISAGREEMENT_HIGH");
    if (hasHighWarning) reasonCodes.push("HIGH_WARNING");
    return { decision: "watch", preferredSide, reasonCodes };
  }

  reasonCodes.push("NO_EDGE");
  return { decision: "rejected", preferredSide, reasonCodes };
}

/* ---------------------------------------------------------------------------
   Structured, deterministic explanation (positive evidence + risks). No LLM,
   no generated numbers — every line is derived from real signals.
   ------------------------------------------------------------------------- */

export interface ExplainInput {
  propLabel: string;
  line?: number;
  preferredSide?: Side;
  projection: number;
  probMore?: number;
  probLess?: number;
  recent: { l5?: WindowStat; l10?: WindowStat; l20?: WindowStat; season?: WindowStat };
  fragility: FragilityLevel;
  disagreement: DisagreementSeverity | "unknown";
  dataQuality: number;
  sampleSize?: number;
  /** Spread of model probabilities (max−min), in probability points. */
  modelProbabilityRange?: number;
  marginalProb?: number;
  baselineProb?: number;
  paProb?: number;
  /** Recent-form trend (EWMA ratio + direction) for projection-only reasoning. */
  trend?: { formRatio: number; direction: "up" | "down" | "flat" };
  context: { opponentName?: string; lineupConfirmed?: boolean; starterConfirmed?: boolean };
  engineWarnings: PredictionWarning[];
}

/**
 * Deterministic, quantitative explanation. Every statement is traceable to a real
 * field (projection−line gap, historical L10, model probability spread, fragility,
 * disagreement, data quality). In projection-only mode (no line) it reasons about
 * the projected performance itself and never uses MORE/LESS/edge language.
 */
export function buildExplanation(x: ExplainInput): { reasons: string[]; risks: string[] } {
  const reasons: string[] = [];
  const risks: string[] = [];
  const side = x.preferredSide;
  const hasLine = x.line !== undefined && side !== undefined;

  if (hasLine) {
    const dir = side === "more" ? "over" : "under";
    const diff = round(x.projection - x.line!);
    const gap = Math.abs(diff);
    if ((side === "more" && diff > 0) || (side === "less" && diff < 0)) {
      reasons.push(`projection ${round(x.projection)} is ${gap} ${side === "more" ? "above" : "below"} line ${x.line} (${side.toUpperCase()})`);
    } else if (gap < 1e-9) {
      risks.push(`projection ${round(x.projection)} sits on line ${x.line} — coin-flip`);
    } else {
      risks.push(`projection ${round(x.projection)} is ${gap} on the ${dir === "over" ? "under" : "over"} side of ${x.line}`);
    }

    // Historical L10 support on the preferred side (explicitly not the model prob).
    const l10 = x.recent.l10;
    if (l10?.hitRate !== undefined) {
      const reached = side === "more" ? l10.hitRate : 1 - l10.hitRate;
      const reachedPct = Math.round(reached * 100);
      if (reached >= 0.6) reasons.push(`${reachedPct}% of last 10 cleared the ${dir} side of ${x.line} (historical, not a probability)`);
      else if (reached <= 0.4) risks.push(`only ${reachedPct}% of last 10 cleared the ${dir} side of ${x.line}`);
    }

    // Model probability spread (quantitative).
    if (x.modelProbabilityRange !== undefined) {
      const pts = Math.round(x.modelProbabilityRange * 100);
      if (pts <= 8) reasons.push(`models agree within ${pts}pts`);
      else if (pts >= 18) risks.push(`models disagree by ${pts}pts`);
    }
    if (x.marginalProb !== undefined && x.baselineProb !== undefined && Math.abs(x.marginalProb - x.baselineProb) <= 0.1) {
      reasons.push(`marginal (${pctStr(x.marginalProb)}) and baseline (${pctStr(x.baselineProb)}) models agree`);
    }
    if (x.paProb !== undefined) reasons.push(`plate-appearance model ${pctStr(x.paProb)}`);
  } else {
    // Projection-only: reason about the projected performance itself.
    reasons.push(`model projects ${round(x.projection)} ${x.propLabel.toLowerCase()}`);
    const s = x.recent.season, l10 = x.recent.l10;
    if (l10 && s) {
      const arrow = x.trend?.direction === "up" ? "trending up" : x.trend?.direction === "down" ? "trending down" : "steady";
      reasons.push(`L10 average ${round(l10.average)} vs season ${round(s.average)} (${arrow})`);
    }
    if (x.modelProbabilityRange !== undefined && x.modelProbabilityRange <= 0.08) reasons.push("independent models converge");
  }

  // Matchup context (only when present — never fabricated).
  if (x.context.opponentName) reasons.push(`matchup vs ${x.context.opponentName} resolved`);
  if (x.context.lineupConfirmed === false) risks.push("lineup not confirmed (projected)");

  // Robustness (quantitative labels).
  if (x.fragility === "LOW") reasons.push("low fragility — projection stable under plausible shifts");
  else if (x.fragility === "MODERATE") risks.push("moderate fragility");
  else if (x.fragility === "HIGH") risks.push("high fragility — sensitive to assumptions");
  else risks.push("extreme fragility — result not robust");

  if (x.disagreement === "low") reasons.push("low model disagreement");
  else if (x.disagreement === "medium") risks.push("moderate model disagreement");
  else if (x.disagreement === "high") risks.push("high model disagreement");

  const n = x.sampleSize;
  if (n !== undefined && n < 8) risks.push(`limited sample (${n} games)`);
  if (x.dataQuality >= 80) reasons.push(`strong data quality (${Math.round(x.dataQuality)}/100)`);
  else if (x.dataQuality < 55) risks.push(`limited data quality (${Math.round(x.dataQuality)}/100)`);

  for (const w of x.engineWarnings) {
    if (w.severity === "info") continue;
    risks.push(w.message ?? w.code.replace(/_/g, " "));
  }
  risks.push(hasLine
    ? "screening probability is uncalibrated — open Full Analysis for the calibrated decision"
    : "projection shown; no market line imported, so no MORE/LESS edge is claimed");

  return { reasons: dedupe(reasons), risks: dedupe(risks) };
}

/* ---------------------------------------------------------------------------
   Projection-quality status (no line). Deterministic — grades how strong and
   reliable the projected performance is; it is NEVER a MORE/LESS pick.
   ------------------------------------------------------------------------- */

export interface ProjectionStatusInput {
  dataQuality: number;
  fragility: FragilityLevel;
  disagreement: DisagreementSeverity | "unknown";
  sampleSize: number;
}

export function projectionStatus(x: ProjectionStatusInput): ProjectionStatus {
  if (x.sampleSize < 6 || x.dataQuality < 40) return "limited_data";
  if (x.fragility === "HIGH" || x.fragility === "EXTREME" || x.disagreement === "high") return "volatile";
  if (x.dataQuality >= 75 && x.fragility === "LOW" && x.disagreement === "low" && x.sampleSize >= 15) return "strong";
  // (disagreement === "high" already returned "volatile" above)
  if (x.dataQuality >= 60 && (x.fragility === "LOW" || x.fragility === "MODERATE")) return "favorable";
  return "neutral";
}

/** 0–100 projection-strength score for ranking projection-only performances. */
export function projectionScore(x: ProjectionStatusInput): number {
  const sampleFactor = 1 - Math.exp(-x.sampleSize / 12);
  const fragilityBonus = x.fragility === "LOW" ? 15 : x.fragility === "MODERATE" ? 8 : x.fragility === "HIGH" ? 0 : -10;
  const disagreementBonus = x.disagreement === "low" ? 10 : x.disagreement === "medium" ? 4 : x.disagreement === "high" ? -5 : 0;
  const raw = 0.5 * x.dataQuality + 25 * sampleFactor + fragilityBonus + disagreementBonus;
  return Math.round(Math.max(0, Math.min(100, raw)));
}

function pctStr(p: number): string {
  return `${Math.round(p * 100)}%`;
}

function round(n: number): number {
  return Math.round(n * 100) / 100;
}
function dedupe(xs: string[]): string[] {
  return [...new Set(xs)];
}
