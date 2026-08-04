/* ============================================================================
   Distribution-drift metrics for scientific monitoring (Phase 14). Population
   Stability Index (PSI) quantifies how much an actual distribution has shifted
   from an expected/baseline one; it feeds the decision engine's drift circuit
   breaker. New module — no equivalent existed in the repo (the backtest metrics
   engine scores calibration/accuracy, not input-distribution drift).

   Insufficient-data handling (corrected): an empty or too-small sample is NOT
   "stable" — it is `insufficient_data`, which is treated as a BREACH so a
   required critical feature with too little drift evidence blocks firm approval
   rather than silently passing. Decile PSI is only valid for continuous inputs;
   binary/categorical/low-cardinality discrete inputs use category-share PSI.
   ========================================================================== */

export type DriftLevel = "stable" | "moderate" | "significant" | "insufficient_data";
export type FeatureType = "continuous" | "discrete" | "categorical" | "binary";

/** Minimum samples per side to compute a trustworthy drift metric. */
export const MIN_DRIFT_SAMPLE = 20;

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

function psiFromShares(e: number[], a: number[]): number {
  const floor = 1e-4;
  let psi = 0;
  for (let i = 0; i < e.length; i++) {
    const ei = Math.max(floor, e[i]);
    const ai = Math.max(floor, a[i]);
    psi += (ai - ei) * Math.log(ai / ei);
  }
  return Math.round(psi * 10000) / 10000;
}

/**
 * Continuous PSI over deciles. 0 = identical; conventionally <0.1 stable,
 * 0.1–0.25 moderate shift, >0.25 significant drift. Zero-share bins are floored
 * to avoid log/÷0. Empty input returns 0 (see assessDrift for the sufficiency
 * verdict — a zero here does NOT mean "no drift", it means "not computed").
 */
export function populationStabilityIndex(expected: number[], actual: number[], bins = 10): number {
  if (expected.length === 0 || actual.length === 0) return 0;
  const { e, a } = binShares(expected, actual, bins);
  if (e.length === 0 || a.length === 0) return 0;
  return psiFromShares(e, a);
}

/**
 * Category-share PSI for binary / categorical / low-cardinality discrete inputs.
 * Bins are the distinct category labels (never deciles), so a two-value input is
 * not crushed into one decile bucket.
 */
export function categoricalPsi(expected: Array<string | number>, actual: Array<string | number>): number {
  if (expected.length === 0 || actual.length === 0) return 0;
  const cats = new Set<string | number>([...expected, ...actual]);
  const share = (arr: Array<string | number>, c: string | number) =>
    arr.filter((v) => v === c).length / (arr.length || 1);
  const e: number[] = [];
  const a: number[] = [];
  for (const c of cats) {
    e.push(share(expected, c));
    a.push(share(actual, c));
  }
  return psiFromShares(e, a);
}

export function classifyDrift(psi: number): "stable" | "moderate" | "significant" {
  if (psi < 0.1) return "stable";
  if (psi < 0.25) return "moderate";
  return "significant";
}

export interface DriftReport {
  psi: number;
  level: DriftLevel;
  /** True when drift is significant enough — OR data is insufficient — to trip a breaker. */
  breach: boolean;
  /** True when a sample was empty or below MIN_DRIFT_SAMPLE (never "stable"). */
  insufficientData: boolean;
  referenceCount: number;
  currentCount: number;
}

function sufficiency(referenceCount: number, currentCount: number, minSample: number): DriftReport | null {
  if (referenceCount < minSample || currentCount < minSample) {
    return {
      psi: 0,
      level: "insufficient_data",
      breach: true, // block firm approval — we cannot certify the feature is stable
      insufficientData: true,
      referenceCount,
      currentCount,
    };
  }
  return null;
}

/**
 * Continuous-input drift assessment. Empty or too-small samples resolve to
 * `insufficient_data` (a breach), never "stable".
 */
export function assessDrift(
  expected: number[],
  actual: number[],
  breachThreshold = 0.25,
  minSample = MIN_DRIFT_SAMPLE,
): DriftReport {
  const insufficient = sufficiency(expected.length, actual.length, minSample);
  if (insufficient) return insufficient;
  const psi = populationStabilityIndex(expected, actual);
  return {
    psi,
    level: classifyDrift(psi),
    breach: psi >= breachThreshold,
    insufficientData: false,
    referenceCount: expected.length,
    currentCount: actual.length,
  };
}

/**
 * Feature-type-aware drift assessment. Chooses category-share PSI for
 * binary/categorical/low-cardinality discrete inputs and decile PSI for
 * continuous ones. Insufficient data is a breach, not stability.
 */
export function assessFeatureDrift(
  expected: Array<string | number>,
  actual: Array<string | number>,
  opts: { featureType: FeatureType; breachThreshold?: number; minSample?: number },
): DriftReport {
  const breachThreshold = opts.breachThreshold ?? 0.25;
  const minSample = opts.minSample ?? MIN_DRIFT_SAMPLE;
  const insufficient = sufficiency(expected.length, actual.length, minSample);
  if (insufficient) return insufficient;

  const distinct = new Set([...expected, ...actual]).size;
  const useCategorical =
    opts.featureType === "categorical" ||
    opts.featureType === "binary" ||
    (opts.featureType === "discrete" && distinct <= 10);

  const psi = useCategorical
    ? categoricalPsi(expected, actual)
    : populationStabilityIndex(expected.map(Number), actual.map(Number));

  return {
    psi,
    level: classifyDrift(psi),
    breach: psi >= breachThreshold,
    insufficientData: false,
    referenceCount: expected.length,
    currentCount: actual.length,
  };
}
