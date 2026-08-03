/* ============================================================================
   Distribution-drift metrics for scientific monitoring (Phase 14). Population
   Stability Index (PSI) quantifies how much an actual distribution has shifted
   from an expected/baseline one; it feeds the decision engine's drift circuit
   breaker. New module — no equivalent existed in the repo (the backtest metrics
   engine scores calibration/accuracy, not input-distribution drift).
   ========================================================================== */

export type DriftLevel = "stable" | "moderate" | "significant";

/** Bin two samples over the expected sample's deciles and return per-bin shares. */
function binShares(expected: number[], actual: number[], bins = 10): { e: number[]; a: number[] } {
  const sorted = [...expected].sort((x, y) => x - y);
  if (sorted.length === 0) return { e: [], a: [] };
  const edges: number[] = [];
  for (let i = 1; i < bins; i++) edges.push(sorted[Math.floor((i / bins) * sorted.length)]);
  const idx = (v: number) => {
    let i = 0;
    while (i < edges.length && v > edges[i]) i++;
    return i;
  };
  const e = new Array(bins).fill(0);
  const a = new Array(bins).fill(0);
  for (const v of expected) e[idx(v)]++;
  for (const v of actual) a[idx(v)]++;
  const eSum = expected.length || 1;
  const aSum = actual.length || 1;
  return { e: e.map((c) => c / eSum), a: a.map((c) => c / aSum) };
}

/**
 * Population Stability Index. 0 = identical; conventionally <0.1 stable,
 * 0.1–0.25 moderate shift, >0.25 significant drift. Zero-share bins are floored
 * to avoid log/÷0.
 */
export function populationStabilityIndex(expected: number[], actual: number[], bins = 10): number {
  if (expected.length === 0 || actual.length === 0) return 0;
  const { e, a } = binShares(expected, actual, bins);
  if (e.length === 0 || a.length === 0) return 0;
  const floor = 1e-4;
  let psi = 0;
  for (let i = 0; i < e.length; i++) {
    const ei = Math.max(floor, e[i]);
    const ai = Math.max(floor, a[i]);
    psi += (ai - ei) * Math.log(ai / ei);
  }
  return Math.round(psi * 10000) / 10000;
}

export function classifyDrift(psi: number): DriftLevel {
  if (psi < 0.1) return "stable";
  if (psi < 0.25) return "moderate";
  return "significant";
}

export interface DriftReport {
  psi: number;
  level: DriftLevel;
  /** True when drift is significant enough to trip a circuit breaker. */
  breach: boolean;
}

export function assessDrift(expected: number[], actual: number[], breachThreshold = 0.25): DriftReport {
  const psi = populationStabilityIndex(expected, actual);
  return { psi, level: classifyDrift(psi), breach: psi >= breachThreshold };
}
