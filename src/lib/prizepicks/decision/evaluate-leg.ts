/* ============================================================================
   Leg evaluation — the per-leg analytical direction, distinct from the final
   ENTRY action. A leg can be MORE_CANDIDATE / LESS_CANDIDATE / REJECTED /
   WAITING / UNAVAILABLE. A firm BET_MORE/BET_LESS is only ever produced at the
   entry level (evaluate-entry), because PrizePicks economics are entry-based.
   ========================================================================== */

import type { DecisionPolicy, DecisionReason, DecisionVeto, LegCandidate } from "./types";
import { computeLegGates, type LegFacts, type GateResult } from "./veto";
import { reason, veto, VETO } from "./reasons";

export interface LegEvaluation {
  facts: LegFacts;
  candidate: LegCandidate;
  side?: "more" | "less";
  selectedSideProbability?: number;
  gates: GateResult;
  reasons: DecisionReason[];
  vetoes: DecisionVeto[];
  releaseConditions: string[];
}

export function evaluateLeg(f: LegFacts, policy: DecisionPolicy): LegEvaluation {
  const gates = computeLegGates(f, policy);
  const reasons: DecisionReason[] = [...gates.unavailable, ...gates.wait, ...gates.noBet, ...gates.info];
  const vetoes: DecisionVeto[] = [...gates.vetoes];
  const releaseConditions = gates.wait.map((w) => w.message);

  // UNAVAILABLE dominates.
  if (gates.unavailable.length > 0) {
    return { facts: f, candidate: "UNAVAILABLE", gates, reasons, vetoes, releaseConditions };
  }

  const pMore = f.probabilityMore ?? 0;
  const pLess = f.probabilityLess ?? 0;

  // Contradiction: both sides clear the bar (impossible unless a push/data defect).
  if (pMore >= policy.minimumSelectedSideProbability && pLess >= policy.minimumSelectedSideProbability) {
    const v = veto(VETO.BOTH_SIDES_QUALIFY, "Both sides satisfy the probability threshold — data/push defect.");
    reasons.push(reason("BOTH_SIDES_QUALIFY", "PROBABILITY", "CRITICAL", v.message, `${pMore}/${pLess}`));
    return { facts: f, candidate: "UNAVAILABLE", gates, reasons, vetoes: [...vetoes, v], releaseConditions };
  }

  // WAIT dominates NO_BET / BET.
  if (gates.wait.length > 0) {
    return { facts: f, candidate: "WAITING", gates, reasons, vetoes, releaseConditions };
  }

  const side: "more" | "less" = pMore >= pLess ? "more" : "less";
  const selected = Math.max(pMore, pLess);

  // Soft threshold rejections (analysis complete → REJECTED at leg level → NO_BET at entry).
  const softNoBet: DecisionReason[] = [];
  if (pMore === pLess) {
    softNoBet.push(reason("NO_DIRECTIONAL_EDGE", "PROBABILITY", "WARNING", "No directional edge (P(More) == P(Less))."));
  }
  if (selected < policy.minimumSelectedSideProbability) {
    softNoBet.push(reason("PROBABILITY_BELOW_MIN", "PROBABILITY", "WARNING", `Selected-side probability ${selected.toFixed(3)} below ${policy.minimumSelectedSideProbability}.`, selected, policy.minimumSelectedSideProbability));
  }
  if (f.confidenceScore !== undefined && f.confidenceScore < policy.minimumConfidence) {
    softNoBet.push(reason("CONFIDENCE_BELOW_MIN", "CONFIDENCE", "WARNING", `Confidence ${f.confidenceScore} below ${policy.minimumConfidence}.`, f.confidenceScore, policy.minimumConfidence));
  }
  if (f.dataQualityScore !== undefined && f.dataQualityScore < policy.minimumDataQuality) {
    softNoBet.push(reason("DATA_QUALITY_BELOW_MIN", "DATA_QUALITY", "WARNING", `Data quality ${f.dataQualityScore} below ${policy.minimumDataQuality}.`, f.dataQualityScore, policy.minimumDataQuality));
  }
  if (f.fragilityScore !== undefined && f.fragilityScore > policy.maximumFragility) {
    softNoBet.push(reason("FRAGILITY_ABOVE_MAX", "FRAGILITY", "WARNING", `Fragility ${f.fragilityScore} above ${policy.maximumFragility}.`, f.fragilityScore, policy.maximumFragility));
  }
  if (policy.maximumVolatility !== undefined && f.volatilityScore !== undefined && f.volatilityScore > policy.maximumVolatility) {
    softNoBet.push(reason("VOLATILITY_ABOVE_MAX", "VOLATILITY", "WARNING", `Volatility ${f.volatilityScore} above ${policy.maximumVolatility}.`, f.volatilityScore, policy.maximumVolatility));
  }
  if (f.worstCaseSelectedProbability !== undefined && f.worstCaseSelectedProbability < policy.minimumSelectedSideProbability) {
    softNoBet.push(reason("SENSITIVITY_WORST_CASE", "FRAGILITY", "WARNING", `Worst credible probability ${f.worstCaseSelectedProbability.toFixed(3)} falls below ${policy.minimumSelectedSideProbability}.`, f.worstCaseSelectedProbability, policy.minimumSelectedSideProbability));
  }

  reasons.push(...softNoBet);

  // REJECTED if any hard-floor veto (gates.noBet) or soft threshold miss.
  if (gates.noBet.length > 0 || softNoBet.length > 0 || vetoes.length > 0) {
    return { facts: f, candidate: "REJECTED", side, selectedSideProbability: selected, gates, reasons, vetoes, releaseConditions };
  }

  // Passes every leg gate — an analytical candidate (still needs entry EV to BET).
  reasons.push(reason("LEG_CANDIDATE", "PROBABILITY", "INFO", `Leg qualifies as a ${side} candidate (pending entry economics).`, selected));
  return {
    facts: f,
    candidate: side === "more" ? "MORE_CANDIDATE" : "LESS_CANDIDATE",
    side,
    selectedSideProbability: selected,
    gates,
    reasons,
    vetoes,
    releaseConditions,
  };
}
