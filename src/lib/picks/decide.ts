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
import type { FragilityLevel, PickDecision, Side, WindowStat } from "./types";

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
  marginalProb?: number;
  baselineProb?: number;
  paProb?: number;
  context: { opponentName?: string; lineupConfirmed?: boolean; starterConfirmed?: boolean };
  engineWarnings: PredictionWarning[];
}

export function buildExplanation(x: ExplainInput): { reasons: string[]; risks: string[] } {
  const reasons: string[] = [];
  const risks: string[] = [];
  const side = x.preferredSide;
  const dir = side === "more" ? "over" : "under";

  if (x.line !== undefined && side) {
    const diff = x.projection - x.line;
    if ((side === "more" && diff > 0) || (side === "less" && diff < 0)) {
      reasons.push(`projection ${round(x.projection)} ${side === "more" ? "exceeds" : "is under"} line ${x.line}`);
    } else if (Math.abs(diff) < 1e-9) {
      risks.push(`projection ${round(x.projection)} sits on the line ${x.line}`);
    } else {
      risks.push(`projection ${round(x.projection)} is on the ${dir === "over" ? "under" : "over"} side of line ${x.line}`);
    }
  }

  // Recent support vs the line (historical hit rate — explicitly not the model prob).
  const l10 = x.recent.l10;
  if (l10?.hitRate !== undefined && x.line !== undefined) {
    const hitPct = Math.round(l10.hitRate * 100);
    if ((side === "more" && l10.hitRate >= 0.6) || (side === "less" && l10.hitRate <= 0.4)) {
      const reachedPct = side === "more" ? hitPct : 100 - hitPct;
      reasons.push(`${reachedPct}% of last 10 landed on the ${dir} side of ${x.line} (historical)`);
    }
  }

  // Model agreement between the independent statistical models.
  if (x.marginalProb !== undefined && x.baselineProb !== undefined) {
    const agree = Math.abs(x.marginalProb - x.baselineProb) <= 0.1;
    if (agree) reasons.push("marginal and baseline models agree");
    else risks.push("marginal and baseline models diverge");
  }
  if (x.paProb !== undefined && x.marginalProb !== undefined && Math.abs(x.paProb - x.marginalProb) <= 0.1) {
    reasons.push("plate-appearance model agrees with the marginal model");
  }

  // Matchup context (only when present — never fabricated).
  if (x.context.opponentName) reasons.push(`matchup vs ${x.context.opponentName} resolved`);

  // Robustness.
  if (x.fragility === "LOW") reasons.push("low fragility (stable projection)");
  else if (x.fragility === "MODERATE") risks.push("moderate fragility");
  else if (x.fragility === "HIGH") risks.push("high fragility — projection sensitive to assumptions");
  else risks.push("extreme fragility — direction not robust");

  if (x.disagreement === "low") reasons.push("models in strong agreement");
  else if (x.disagreement === "high") risks.push("high model disagreement");

  if (x.dataQuality >= 80) reasons.push(`strong data quality (${Math.round(x.dataQuality)})`);
  else if (x.dataQuality < 55) risks.push(`limited data quality (${Math.round(x.dataQuality)})`);

  // Surface the real engine warnings as risks (deduped).
  for (const w of x.engineWarnings) {
    if (w.severity === "info") continue;
    risks.push(w.message ?? w.code.replace(/_/g, " "));
  }
  // Calibration honesty note.
  risks.push("screening probability is uncalibrated — open Full Analysis for the calibrated decision");

  return { reasons: dedupe(reasons), risks: dedupe(risks) };
}

function round(n: number): number {
  return Math.round(n * 100) / 100;
}
function dedupe(xs: string[]): string[] {
  return [...new Set(xs)];
}
