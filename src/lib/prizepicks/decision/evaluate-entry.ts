/* ============================================================================
   Entry evaluation — the FINAL, user-facing decision. PrizePicks economics are
   entry-based, so a firm BET_MORE/BET_LESS is only produced here, after the
   complete-entry expected return clears the policy and no veto blocks the bet.
   Decision precedence is strict: UNAVAILABLE > WAIT > NO_BET > BET.
   ========================================================================== */

import { DEFAULT_DECISION_POLICY } from "./policy";
import { DECISION_ENGINE_VERSION, configChecksum } from "./version";
import { decisionResultSchema, type DecisionPolicy, type DecisionReason, type DecisionResult, type DecisionVeto, type FinalDecision } from "./types";
import { evaluateLeg, type LegEvaluation } from "./evaluate-leg";
import type { LegFacts } from "./veto";
import { reason, veto, VETO } from "./reasons";

export interface EntryEconomicsFacts {
  configured: boolean;
  expectedReturn?: number;
  expectedProfit?: number;
  variance?: number;
  downsideProbability?: number;
}

export interface EntryFacts {
  legs: LegFacts[];
  entryFormat: "power" | "flex";
  method: "joint-simulation" | "independence-approximation";
  payoutConfigured: boolean;
  /** Whether the missing payout table can reasonably be supplied (→ WAIT vs UNAVAILABLE). */
  payoutFixable?: boolean;
  payoutTableId?: string | null;
  payoutTableVersion?: string | null;
  economics: EntryEconomicsFacts;
  /** Correlation is material but not captured by the (independence) method. */
  correlationMaterialButUnmodeled?: boolean;
  correlationConcentration?: boolean;
  modelVersion: string;
  featureCutoff: string;
  dataAsOf: string;
  generatedAt?: string;
  lineCapturedAt?: string;
}

export interface EntryDecision {
  entryDecision: DecisionResult;
  legDecisions: DecisionResult[];
  policy: DecisionPolicy;
}

type Klass = "UNAVAILABLE" | "WAIT" | "NO_BET" | "OK";

function entryGates(entry: EntryFacts, policy: DecisionPolicy): {
  klass: Klass;
  reasons: DecisionReason[];
  vetoes: DecisionVeto[];
  release: string[];
} {
  const reasons: DecisionReason[] = [];
  const vetoes: DecisionVeto[] = [];
  const release: string[] = [];
  let klass: Klass = "OK";
  const worse = (k: Klass) => {
    const order: Klass[] = ["OK", "NO_BET", "WAIT", "UNAVAILABLE"];
    if (order.indexOf(k) > order.indexOf(klass)) klass = k;
  };

  if (policy.requirePayoutTable && !entry.payoutConfigured) {
    vetoes.push(veto(VETO.PAYOUT_TABLE_MISSING, "Payout table missing — final BET decision prohibited."));
    if (entry.payoutFixable === false) {
      reasons.push(reason("PAYOUT_TABLE_MISSING", "PAYOUT", "CRITICAL", "No valid payout configuration and none can be supplied."));
      worse("UNAVAILABLE");
    } else {
      reasons.push(reason("PAYOUT_BEING_CONFIGURED", "PAYOUT", "CRITICAL", "Payout table is being configured."));
      release.push("Configure the PrizePicks payout table for this entry format/size.");
      worse("WAIT");
    }
  } else if (policy.requirePayoutTable) {
    if (!entry.economics.configured || entry.economics.expectedReturn === undefined) {
      vetoes.push(veto(VETO.ENTRY_EV_UNAVAILABLE, "Entry expected return unavailable."));
      reasons.push(reason("ENTRY_EV_UNAVAILABLE", "ENTRY_EV", "CRITICAL", "Complete-entry expected return could not be computed."));
      worse("UNAVAILABLE");
    } else if (entry.economics.expectedReturn <= policy.minimumEntryExpectedReturn) {
      vetoes.push(veto(VETO.ENTRY_EV_BELOW_MIN, `Entry expected return ${entry.economics.expectedReturn}× ≤ ${policy.minimumEntryExpectedReturn}×.`));
      reasons.push(reason("ENTRY_EV_BELOW_MIN", "ENTRY_EV", "CRITICAL", `Complete-entry expected return ${entry.economics.expectedReturn}× is at or below ${policy.minimumEntryExpectedReturn}×.`, entry.economics.expectedReturn, policy.minimumEntryExpectedReturn));
      worse("NO_BET");
    }
  }

  if (entry.method === "independence-approximation" && entry.correlationMaterialButUnmodeled) {
    vetoes.push(veto(VETO.UNMODELED_CORRELATION, "Material correlation not modeled (independence approximation) — BET prohibited."));
    reasons.push(reason("UNMODELED_CORRELATION", "CORRELATION", "CRITICAL", "Legs are likely correlated but only an independence approximation is available."));
    worse("NO_BET");
  }
  if (entry.correlationConcentration) {
    reasons.push(reason("CORRELATION_CONCENTRATION", "CORRELATION", "WARNING", "Unacceptable correlation / exposure concentration across legs."));
    worse("NO_BET");
  }

  return { klass, reasons, vetoes, release };
}

function timestamps(entry: EntryFacts) {
  const now = new Date().toISOString();
  return { generatedAt: entry.generatedAt ?? now, featureCutoff: entry.featureCutoff, dataAsOf: entry.dataAsOf };
}

function build(
  subjectType: "LEG" | "ENTRY",
  decision: FinalDecision,
  policy: DecisionPolicy,
  entry: EntryFacts,
  fields: Partial<DecisionResult>,
  reasons: DecisionReason[],
  vetoes: DecisionVeto[],
  release: string[],
): DecisionResult {
  const ts = timestamps(entry);
  const result: DecisionResult = {
    decision,
    subjectType,
    decisionPolicyId: policy.id,
    decisionPolicyVersion: policy.version,
    modelVersion: entry.modelVersion,
    configChecksum: configChecksum({ engine: DECISION_ENGINE_VERSION, policy }),
    generatedAt: ts.generatedAt,
    featureCutoff: ts.featureCutoff,
    dataAsOf: ts.dataAsOf,
    lineCapturedAt: entry.lineCapturedAt,
    payoutTableId: entry.payoutTableId ?? null,
    payoutTableVersion: entry.payoutTableVersion ?? null,
    method: entry.method,
    reasons,
    vetoes,
    releaseConditions: release.length ? release : undefined,
    nextReviewAt: decision === "WAIT" ? nextReview() : null,
    ...fields,
  };
  return decisionResultSchema.parse(result);
}

function nextReview(): string {
  return new Date(Date.now() + 30 * 60_000).toISOString(); // recheck in ~30 min
}

/** Evaluate a complete PrizePicks entry → final entry decision + per-leg decisions. */
export function evaluateEntry(entry: EntryFacts, policy: DecisionPolicy = DEFAULT_DECISION_POLICY): EntryDecision {
  const legEvals: LegEvaluation[] = entry.legs.map((l) => evaluateLeg(l, policy));
  const gates = entryGates(entry, policy);

  // Roll-up precedence over legs + entry gates.
  const anyUnavailable = legEvals.some((l) => l.candidate === "UNAVAILABLE") || gates.klass === "UNAVAILABLE";
  const anyWait = legEvals.some((l) => l.candidate === "WAITING") || gates.klass === "WAIT";
  const anyNoBet = legEvals.some((l) => l.candidate === "REJECTED") || gates.klass === "NO_BET";

  let entryDecisionState: FinalDecision;
  if (anyUnavailable) entryDecisionState = "UNAVAILABLE";
  else if (anyWait) entryDecisionState = "WAIT";
  else if (anyNoBet) entryDecisionState = "NO_BET";
  else {
    // All legs are candidates and entry EV cleared → bettable.
    const sides = new Set(legEvals.map((l) => l.side));
    entryDecisionState = sides.size === 1 && sides.has("less") ? "BET_LESS" : "BET_MORE";
  }

  const entryReasons: DecisionReason[] = [
    ...gates.reasons,
    reason("ENTRY_ROLLUP", "ENTRY_EV", "INFO", `Entry roll-up over ${entry.legs.length} legs → ${entryDecisionState}.`),
  ];
  const entryVetoes = [...gates.vetoes];
  const entryRelease = [...gates.release, ...legEvals.flatMap((l) => l.releaseConditions)];

  const entryDecision = build("ENTRY", entryDecisionState, policy, entry, {
    entryExpectedReturn: entry.economics.expectedReturn ?? null,
    entryExpectedProfit: entry.economics.expectedProfit ?? null,
    entryVariance: entry.economics.variance ?? null,
    downsideProbability: entry.economics.downsideProbability ?? null,
  }, entryReasons, entryVetoes, entryRelease);

  // Per-leg final decisions in entry context.
  const legDecisions = legEvals.map((le) => {
    let d: FinalDecision;
    const legReasons = [...le.reasons];
    const legVetoes = [...le.vetoes];
    if (le.candidate === "UNAVAILABLE") d = "UNAVAILABLE";
    else if (le.candidate === "WAITING") d = "WAIT";
    else if (le.candidate === "REJECTED") d = "NO_BET";
    else {
      // Candidate leg — apply entry-level gates.
      legReasons.push(...gates.reasons);
      legVetoes.push(...gates.vetoes);
      if (gates.klass === "UNAVAILABLE") d = "UNAVAILABLE";
      else if (gates.klass === "WAIT") d = "WAIT";
      else if (gates.klass === "NO_BET") d = "NO_BET";
      else d = le.side === "less" ? "BET_LESS" : "BET_MORE";
    }
    return build("LEG", d, policy, entry, {
      playerId: le.facts.playerId,
      gamePk: le.facts.gamePk,
      market: le.facts.market,
      line: le.facts.line,
      selectedSideProbability: le.selectedSideProbability,
      probabilityMore: le.facts.probabilityMore,
      probabilityLess: le.facts.probabilityLess,
      probabilityPush: le.facts.probabilityPush,
      confidenceScore: le.facts.confidenceScore,
      dataQualityScore: le.facts.dataQualityScore,
      volatilityScore: le.facts.volatilityScore,
      fragilityScore: le.facts.fragilityScore,
      marketValidationState: le.facts.marketValidationState,
      entryExpectedReturn: entry.economics.expectedReturn ?? null,
    }, legReasons, legVetoes, le.releaseConditions);
  });

  return { entryDecision, legDecisions, policy };
}

export { DEFAULT_DECISION_POLICY } from "./policy";
export type { LegFacts } from "./veto";
