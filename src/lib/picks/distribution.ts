/* ============================================================================
   Pure threshold + robustness helpers for Player Picks. All of these READ the
   distribution / interval the existing engine already produced — none of them
   re-model, re-simulate, or change a projection. A market line is only a
   threshold; alternative lines reuse the SAME distribution.
   ========================================================================== */

import { clamp } from "@/lib/utils";
import type { DistributionBucket, SimulationResult } from "@/lib/prediction/simulate";
import type { AltLineAnalysis, FragilityLevel } from "./types";

/**
 * Directional probabilities for a threshold read from an already-computed
 * distribution. P(more) = mass strictly above the line; P(less) = mass strictly
 * below; the remainder is the push mass on an integer line.
 */
export function probsFromDistribution(
  distribution: DistributionBucket[],
  line: number,
): { probMore: number; probLess: number; probPush: number } {
  let total = 0;
  let more = 0;
  let less = 0;
  let push = 0;
  for (const b of distribution) {
    total += b.probability;
    if (b.value > line) more += b.probability;
    else if (b.value < line) less += b.probability;
    else push += b.probability;
  }
  if (total <= 0) return { probMore: 0, probLess: 0, probPush: 0 };
  return {
    probMore: clamp(more / total, 0, 1),
    probLess: clamp(less / total, 0, 1),
    probPush: clamp(push / total, 0, 1),
  };
}

/**
 * Analyze alternative lines against the SAME distribution and label them:
 *  - "highest"  : the alt line with the highest raw preferred-side probability
 *  - "standard" : the primary (standard) line
 *  - "aggressive": a demon-style line whose preferred prob is < 0.5
 *  - "avoid"    : preferred prob below a coin flip
 * Probability and value are labeled separately — a higher probability is never
 * asserted to be "better value".
 */
export function analyzeAltLines(
  distribution: DistributionBucket[],
  primary: { line: number; projectionType?: string },
  alternatives: { line: number; projectionType?: string }[],
  preferredSide: "more" | "less" = "more",
): AltLineAnalysis[] {
  const all = [primary, ...alternatives];
  const scored = all.map((l) => {
    const p = probsFromDistribution(distribution, l.line);
    // Every threshold is judged on the candidate's OVERALL preferred side, so a
    // higher demon line reads as a harder version of the same bet, not a flip.
    return { ...l, probMore: p.probMore, probLess: p.probLess, directional: preferredSide === "more" ? p.probMore : p.probLess };
  });

  // Index of the highest directional probability (ties → first / lowest line).
  let bestIdx = 0;
  for (let i = 1; i < scored.length; i++) {
    if (scored[i].directional > scored[bestIdx].directional) bestIdx = i;
  }

  return scored.map((s, i) => {
    let label: AltLineAnalysis["label"];
    if (s.directional < 0.5) label = "avoid";
    else if (i === 0) label = "standard";
    else if (i === bestIdx) label = "highest";
    else label = "aggressive";
    return {
      line: s.line,
      projectionType: s.projectionType,
      probMore: s.probMore,
      probLess: s.probLess,
      label,
    };
  });
}

/**
 * Lightweight fragility PROXY: how robust is the PREFERRED SIDE, measured as the
 * standardized distance of the projection from the line (|mean − line| / stdDev).
 * A projection sitting on the line is a coin flip whose side flips under any small
 * change ⇒ fragile; a projection far from the line (relative to the outcome
 * spread) is robust. This is cheap (reuses the sim's mean/stdDev — no extra
 * simulations); the full scenario-based sensitivity sweep lives on the Full
 * Analysis page. It intentionally measures SIDE stability, not raw outcome
 * variance (which is inherent to count props and would flag everything).
 */
export function fragilityProxy(sim: SimulationResult, line: number): FragilityLevel {
  const sd = Math.max(sim.stdDev, 1e-6);
  const z = Math.abs(sim.mean - line) / sd; // standardized edge
  if (z >= 0.6) return "LOW";
  if (z >= 0.35) return "MODERATE";
  if (z >= 0.15) return "HIGH";
  return "EXTREME";
}
