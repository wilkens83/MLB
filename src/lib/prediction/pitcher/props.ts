/* ============================================================================
   Prop-threshold evaluation. The joint simulation produces the player's outcome
   distribution FIRST; a PrizePicks line is applied here, AFTERWARD, as a cheap
   read of the retained samples. Changing the line (5.5 → 6.5, or goblin/demon)
   reuses the SAME samples — it never re-runs the pitcher-start model.
   ========================================================================== */

import { summarizeSamples, type SimulationResult } from "@/lib/prediction/simulate";
import type { DistFamily } from "@/lib/props/catalog";
import type { PitcherJointProp, PitcherJointSimulation } from "./types";

/** SimulationResult for one prop at one line, read from the joint samples. */
export function propSimulationFromJoint(
  joint: PitcherJointSimulation,
  prop: PitcherJointProp,
  line: number,
  family: DistFamily = "negbinom",
): SimulationResult {
  return summarizeSamples(joint.samples[prop], line, family);
}

/** Correlation between two props from the joint samples (never marginal product). */
export function jointCorrelation(joint: PitcherJointSimulation, a: PitcherJointProp, b: PitcherJointProp): number {
  const hit = joint.correlations.find((c) => (c.a === a && c.b === b) || (c.a === b && c.b === a));
  return hit?.pearson ?? 0;
}

/**
 * P(both legs land on their MORE side) from the JOINT samples — the honest joint,
 * not the product of marginals. Threshold is `> line`.
 */
export function jointProbBothMore(
  joint: PitcherJointSimulation,
  a: { prop: PitcherJointProp; line: number },
  b: { prop: PitcherJointProp; line: number },
): number {
  const xa = joint.samples[a.prop];
  const xb = joint.samples[b.prop];
  let both = 0;
  for (let i = 0; i < xa.length; i++) if (xa[i] > a.line && xb[i] > b.line) both++;
  return Math.round((both / (xa.length || 1)) * 10000) / 10000;
}
