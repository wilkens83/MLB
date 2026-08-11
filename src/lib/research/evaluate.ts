/* ============================================================================
   Predictive-value evaluation for context events. Given point-in-time
   observations (an outcome + the events KNOWN at prediction time), it measures
   whether the PRESENCE of an event type/status correlates with the outcome —
   base rate vs event-present rate, with lift and sample sizes.

   This is a VALIDATION GATE, never a feedback loop: it does not touch a
   projection. Until enough persisted point-in-time history exists it returns
   `unvalidated` / `insufficient_history` and NEVER claims Reddit is validated —
   architecture alone is not evidence. "Measure first, tune later."
   ========================================================================== */

import type { ContextEventType, ContextEventStatus } from "./types";

/** One graded, point-in-time observation. `events` are ALREADY leakage-filtered. */
export interface ContextObservation {
  predictionId: string;
  /** The binary outcome under test (caller-defined, e.g. over-hit = 1). */
  outcome: 0 | 1;
  events: { type: ContextEventType; status: ContextEventStatus }[];
}

export interface EventTypeEvaluation {
  type: ContextEventType;
  /** The status filter this row measured ("any" = event present regardless of status). */
  status: ContextEventStatus | "any";
  withEventN: number;
  withoutEventN: number;
  outcomeRateWithEvent: number | null;
  outcomeRateWithoutEvent: number | null;
  /** withEvent − withoutEvent outcome rate; null when either side is too thin. */
  lift: number | null;
  verdict: "insufficient_data" | "no_signal" | "possible_signal";
}

export interface ContextEvaluationReport {
  totalObservations: number;
  baseOutcomeRate: number | null;
  byEvent: EventTypeEvaluation[];
  warnings: string[];
  /** Never "validated": the strongest per-event verdict is "possible_signal". */
  verdict: "unvalidated" | "insufficient_history";
  generatedAt: number;
}

export interface EvaluationConfig {
  /** Minimum total observations before any measurement is attempted. */
  minObservations?: number;
  /** Minimum with-event (and without-event) samples for a per-event verdict. */
  minEventSample?: number;
  /** |lift| at/above which a per-event row is flagged "possible_signal". */
  minLift?: number;
}

const DEFAULTS: Required<EvaluationConfig> = { minObservations: 100, minEventSample: 20, minLift: 0.06 };

function rate(rows: ContextObservation[]): number | null {
  if (rows.length === 0) return null;
  return round(rows.reduce((s, r) => s + r.outcome, 0) / rows.length);
}

/**
 * Evaluate the predictive value of each context type (and its confirmed subset)
 * against the observed outcomes. Descriptive only — no claim of validation.
 */
export function evaluateContextPredictiveValue(
  observations: ContextObservation[],
  config: EvaluationConfig = {},
): ContextEvaluationReport {
  const cfg = { ...DEFAULTS, ...config };
  const warnings: string[] = [];
  const total = observations.length;
  const baseOutcomeRate = rate(observations);

  const insufficientHistory = total < cfg.minObservations;
  if (insufficientHistory) {
    warnings.push(`Only ${total} point-in-time observations (need ≥ ${cfg.minObservations}) — Reddit predictive value is UNVALIDATED.`);
  }

  // Measure each type at "any" status and at "confirmed" status.
  const types = [...new Set(observations.flatMap((o) => o.events.map((e) => e.type)))];
  const byEvent: EventTypeEvaluation[] = [];
  for (const type of types) {
    for (const status of ["any", "confirmed"] as const) {
      const has = (o: ContextObservation) =>
        o.events.some((e) => e.type === type && (status === "any" || e.status === status));
      const withEvent = observations.filter(has);
      const withoutEvent = observations.filter((o) => !has(o));
      const rWith = rate(withEvent);
      const rWithout = rate(withoutEvent);
      const enough = withEvent.length >= cfg.minEventSample && withoutEvent.length >= cfg.minEventSample;
      const lift = enough && rWith !== null && rWithout !== null ? round(rWith - rWithout) : null;
      const verdict: EventTypeEvaluation["verdict"] =
        !enough ? "insufficient_data"
          : lift !== null && Math.abs(lift) >= cfg.minLift ? "possible_signal" : "no_signal";
      byEvent.push({
        type, status, withEventN: withEvent.length, withoutEventN: withoutEvent.length,
        outcomeRateWithEvent: rWith, outcomeRateWithoutEvent: rWithout, lift, verdict,
      });
    }
  }
  byEvent.sort((a, b) => (Math.abs(b.lift ?? 0)) - (Math.abs(a.lift ?? 0)));

  return {
    totalObservations: total,
    baseOutcomeRate,
    byEvent,
    warnings,
    // The harness never promotes to "validated" — that is a governance decision
    // made from a report, not by architecture.
    verdict: insufficientHistory ? "insufficient_history" : "unvalidated",
    generatedAt: Date.now(),
  };
}

function round(x: number): number { return Math.round(x * 10000) / 10000; }
