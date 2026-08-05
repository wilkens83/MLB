/* ============================================================================
   Independent verification. These are DETERMINISTIC checks that re-derive
   invariants from a result — they never ask the production function whether its
   own output is valid. Each returns a VerificationCheck; the aggregator turns a
   set of checks into a VerificationResult with rejection codes.

   Pure: imports only schemas + the pure odds math, so it runs under Bun and in
   the browser and is independently testable.
   ========================================================================== */

import { americanToImplied } from "@/lib/odds/math";
import type { VerificationCheck, VerificationResult } from "@/schemas/verification";

const check = (name: string, passed: boolean, code: string, detail?: string): VerificationCheck => ({
  name, passed, code, detail,
});

const finite = (n: number | undefined): n is number => typeof n === "number" && Number.isFinite(n);
const inUnit = (n: number | undefined): boolean => finite(n) && n! >= 0 && n! <= 1;

/** All required fields present. */
export function dataCompletenessVerifier(fields: Record<string, unknown>, required: string[]): VerificationCheck {
  const missing = required.filter((k) => fields[k] === undefined || fields[k] === null);
  return check("DataCompleteness", missing.length === 0, "DATA_INCOMPLETE",
    missing.length ? `missing: ${missing.join(", ")}` : undefined);
}

/** Sample size meets the configured minimum. */
export function sampleQualityVerifier(sampleSize: number, minSample: number): VerificationCheck {
  return check("SampleQuality", sampleSize >= minSample, "SAMPLE_TOO_SMALL",
    sampleSize < minSample ? `sample ${sampleSize} < ${minSample}` : undefined);
}

/** Projection mean is finite and non-negative for count props. */
export function projectionSanityVerifier(mean: number | undefined, opts: { allowNegative?: boolean } = {}): VerificationCheck {
  const ok = finite(mean) && (opts.allowNegative || mean! >= 0);
  return check("ProjectionSanity", ok, "PROJECTION_INSANE",
    ok ? undefined : `mean=${mean}`);
}

/** Every probability is finite and within [0,1]; the tri-partition sums to ~1. */
export function probabilityBoundsVerifier(p: { over?: number; under?: number; push?: number }): VerificationCheck {
  const each = inUnit(p.over) && inUnit(p.under) && inUnit(p.push);
  const sum = (p.over ?? 0) + (p.under ?? 0) + (p.push ?? 0);
  const sums = Math.abs(sum - 1) < 1e-2;
  return check("ProbabilityBounds", each && sums, "PROB_OUT_OF_BOUNDS",
    !each ? "a probability is NaN/Inf or outside [0,1]" : !sums ? `probabilities sum to ${sum.toFixed(3)}` : undefined);
}

/** Odds convert to a sane implied probability (guards impossible odds). */
export function oddsMathVerifier(american: number | undefined): VerificationCheck {
  if (american === undefined) return check("OddsMath", true, "ODDS_MATH", "no price supplied (skipped)");
  const implied = americanToImplied(american);
  const ok = finite(implied) && implied > 0 && implied < 1;
  return check("OddsMath", ok, "ODDS_IMPOSSIBLE", ok ? undefined : `american=${american} → implied=${implied}`);
}

/** Simulation is stable: enough iterations and a finite, non-negative stdDev. */
export function simulationStabilityVerifier(iterations: number, stdDev: number, minIterations = 1000): VerificationCheck {
  const ok = iterations >= minIterations && finite(stdDev) && stdDev >= 0;
  return check("SimulationStability", ok, "SIM_UNSTABLE",
    ok ? undefined : `iterations=${iterations}, stdDev=${stdDev}`);
}

/** Empirical and analytic probabilities agree within tolerance. */
export function crossMethodAgreementVerifier(empirical: number | undefined, analytic: number | undefined, tol = 0.15): VerificationCheck {
  if (!finite(empirical) || !finite(analytic)) {
    return check("CrossMethodAgreement", true, "CROSS_METHOD", "one method unavailable (skipped)");
  }
  const diff = Math.abs(empirical! - analytic!);
  return check("CrossMethodAgreement", diff <= tol, "MODEL_DISAGREEMENT",
    diff > tol ? `|empirical−analytic|=${diff.toFixed(3)} > ${tol}` : undefined);
}

/** Data is fresh enough and the feature cutoff precedes the event (no leakage). */
export function freshnessVerifier(args: { featureCutoff?: string; eventStartTime?: string; lineupConfirmed?: boolean; requireLineup?: boolean }): VerificationCheck {
  if (args.featureCutoff && args.eventStartTime && Date.parse(args.featureCutoff) > Date.parse(args.eventStartTime)) {
    return check("Freshness", false, "LEAKAGE", "feature cutoff after event start");
  }
  if (args.requireLineup && !args.lineupConfirmed) {
    return check("Freshness", false, "STALE_LINEUP", "required lineup not confirmed");
  }
  return check("Freshness", true, "FRESHNESS");
}

/** A recommendation is internally consistent (a firm side needs a valid prob). */
export function recommendationVerifier(rec: { side?: string; probability?: number; status: string }): VerificationCheck {
  if (rec.status === "ok") {
    const ok = !!rec.side && inUnit(rec.probability);
    return check("Recommendation", ok, "RECO_INCONSISTENT", ok ? undefined : "ok recommendation lacks side/probability");
  }
  return check("Recommendation", true, "RECOMMENDATION");
}

/** Aggregate a set of checks into a pass/fail result with rejection codes. */
export function aggregate(checks: VerificationCheck[]): VerificationResult {
  const rejections = checks.filter((c) => !c.passed).map((c) => c.code ?? c.name);
  return { passed: rejections.length === 0, checks, rejections };
}
