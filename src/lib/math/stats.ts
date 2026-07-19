/* ============================================================================
   Statistics core — pure, dependency-free, deterministic.
   Shared foundation for the analytics and prediction engines.
   ========================================================================== */

/** Seedable RNG (mulberry32) for reproducible Monte Carlo runs. */
export function mulberry32(seed: number) {
  let a = seed >>> 0;
  return function next() {
    a |= 0;
    a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

export type Rng = () => number;

/** Turn an arbitrary string into a 32-bit seed (xfnv1a). */
export function seedFromString(str: string) {
  let h = 2166136261 >>> 0;
  for (let i = 0; i < str.length; i++) {
    h = Math.imul(h ^ str.charCodeAt(i), 16777619);
  }
  return h >>> 0;
}

export function mean(xs: readonly number[]): number {
  if (xs.length === 0) return NaN;
  let s = 0;
  for (const x of xs) s += x;
  return s / xs.length;
}

export function variance(xs: readonly number[], sample = true): number {
  const n = xs.length;
  if (n < (sample ? 2 : 1)) return 0;
  const m = mean(xs);
  let s = 0;
  for (const x of xs) s += (x - m) ** 2;
  return s / (sample ? n - 1 : n);
}

export function stdDev(xs: readonly number[], sample = true): number {
  return Math.sqrt(variance(xs, sample));
}

/** Coefficient of variation — lower means more consistent. */
export function coefficientOfVariation(xs: readonly number[]): number {
  const m = mean(xs);
  if (m === 0) return NaN;
  return stdDev(xs) / Math.abs(m);
}

export function median(xs: readonly number[]): number {
  return quantile(xs, 0.5);
}

/** Type-7 (linear interpolation) quantile, matching NumPy/R defaults. */
export function quantile(xs: readonly number[], q: number): number {
  if (xs.length === 0) return NaN;
  if (xs.length === 1) return xs[0];
  const sorted = [...xs].sort((a, b) => a - b);
  const pos = (sorted.length - 1) * q;
  const base = Math.floor(pos);
  const rest = pos - base;
  const lo = sorted[base];
  const hi = sorted[Math.min(base + 1, sorted.length - 1)];
  return lo + rest * (hi - lo);
}

/** Percentile rank (0..100) of `value` within `xs`, midrank convention. */
export function percentileRank(xs: readonly number[], value: number): number {
  if (xs.length === 0) return NaN;
  let below = 0;
  let equal = 0;
  for (const x of xs) {
    if (x < value) below++;
    else if (x === value) equal++;
  }
  return ((below + 0.5 * equal) / xs.length) * 100;
}

/** Exponentially weighted moving average (most recent weighted highest). */
export function ewma(xs: readonly number[], alpha = 0.4): number {
  if (xs.length === 0) return NaN;
  let acc = xs[0];
  for (let i = 1; i < xs.length; i++) acc = alpha * xs[i] + (1 - alpha) * acc;
  return acc;
}

/** Trailing rolling averages of window `w` across the series. */
export function rollingAverage(xs: readonly number[], w: number): number[] {
  const out: number[] = [];
  for (let i = 0; i < xs.length; i++) {
    const start = Math.max(0, i - w + 1);
    out.push(mean(xs.slice(start, i + 1)));
  }
  return out;
}

/* ---------------------------------------------------------------------------
   Special functions
   ------------------------------------------------------------------------- */

const LG_C = [
  76.18009172947146, -86.50532032941677, 24.01409824083091, -1.231739572450155,
  0.1208650973866179e-2, -0.5395239384953e-5,
];

/** Log-gamma via Lanczos approximation. */
export function logGamma(x: number): number {
  let y = x;
  let tmp = x + 5.5;
  tmp -= (x + 0.5) * Math.log(tmp);
  let ser = 1.000000000190015;
  for (let j = 0; j < 6; j++) {
    y += 1;
    ser += LG_C[j] / y;
  }
  return -tmp + Math.log((2.5066282746310005 * ser) / x);
}

export function logFactorial(n: number): number {
  return logGamma(n + 1);
}

/** Standard normal PDF. */
export function normalPdf(x: number, mu = 0, sigma = 1): number {
  const z = (x - mu) / sigma;
  return Math.exp(-0.5 * z * z) / (sigma * Math.sqrt(2 * Math.PI));
}

/** Standard normal CDF via Abramowitz-Stegun 7.1.26 error function. */
export function normalCdf(x: number, mu = 0, sigma = 1): number {
  const z = (x - mu) / (sigma * Math.SQRT2);
  return 0.5 * (1 + erf(z));
}

export function erf(x: number): number {
  const sign = Math.sign(x);
  const ax = Math.abs(x);
  const t = 1 / (1 + 0.3275911 * ax);
  const y =
    1 -
    ((((1.061405429 * t - 1.453152027) * t + 1.421413741) * t - 0.284496736) * t + 0.254829592) *
      t *
      Math.exp(-ax * ax);
  return sign * y;
}

/** Inverse standard normal CDF (Acklam's algorithm). */
export function normalInv(p: number): number {
  if (p <= 0) return -Infinity;
  if (p >= 1) return Infinity;
  const a = [
    -3.969683028665376e1, 2.209460984245205e2, -2.759285104469687e2, 1.38357751867269e2,
    -3.066479806614716e1, 2.506628277459239,
  ];
  const b = [
    -5.447609879822406e1, 1.615858368580409e2, -1.556989798598866e2, 6.680131188771972e1,
    -1.328068155288572e1,
  ];
  const c = [
    -7.784894002430293e-3, -3.223964580411365e-1, -2.400758277161838, -2.549732539343734,
    4.374664141464968, 2.938163982698783,
  ];
  const d = [
    7.784695709041462e-3, 3.224671290700398e-1, 2.445134137142996, 3.754408661907416,
  ];
  const plow = 0.02425;
  const phigh = 1 - plow;
  let q: number;
  let r: number;
  if (p < plow) {
    q = Math.sqrt(-2 * Math.log(p));
    return (
      (((((c[0] * q + c[1]) * q + c[2]) * q + c[3]) * q + c[4]) * q + c[5]) /
      ((((d[0] * q + d[1]) * q + d[2]) * q + d[3]) * q + 1)
    );
  }
  if (p <= phigh) {
    q = p - 0.5;
    r = q * q;
    return (
      ((((((a[0] * r + a[1]) * r + a[2]) * r + a[3]) * r + a[4]) * r + a[5]) * q) /
      (((((b[0] * r + b[1]) * r + b[2]) * r + b[3]) * r + b[4]) * r + 1)
    );
  }
  q = Math.sqrt(-2 * Math.log(1 - p));
  return (
    -(((((c[0] * q + c[1]) * q + c[2]) * q + c[3]) * q + c[4]) * q + c[5]) /
    ((((d[0] * q + d[1]) * q + d[2]) * q + d[3]) * q + 1)
  );
}

/* ---------------------------------------------------------------------------
   Discrete distributions used for count props
   ------------------------------------------------------------------------- */

/** Poisson probability mass function P(X = k | lambda). */
export function poissonPmf(k: number, lambda: number): number {
  if (k < 0 || !Number.isInteger(k)) return 0;
  if (lambda <= 0) return k === 0 ? 1 : 0;
  return Math.exp(k * Math.log(lambda) - lambda - logFactorial(k));
}

/** Poisson cumulative P(X <= k). */
export function poissonCdf(k: number, lambda: number): number {
  if (k < 0) return 0;
  let sum = 0;
  for (let i = 0; i <= Math.floor(k); i++) sum += poissonPmf(i, lambda);
  return Math.min(1, sum);
}

/** Sample from Poisson(lambda) via Knuth (small lambda) / normal approx (large). */
export function samplePoisson(lambda: number, rng: Rng): number {
  if (lambda <= 0) return 0;
  if (lambda < 30) {
    const L = Math.exp(-lambda);
    let k = 0;
    let p = 1;
    do {
      k++;
      p *= rng();
    } while (p > L);
    return k - 1;
  }
  // Normal approximation with continuity correction for large lambda.
  const g = lambda + Math.sqrt(lambda) * gaussian(rng);
  return Math.max(0, Math.round(g));
}

/** Negative-binomial PMF parameterised by mean `mu` and dispersion `size` (r). */
export function negBinomPmf(k: number, mu: number, size: number): number {
  if (k < 0 || !Number.isInteger(k)) return 0;
  if (mu <= 0) return k === 0 ? 1 : 0;
  const p = size / (size + mu);
  const logP =
    logGamma(k + size) -
    logGamma(size) -
    logFactorial(k) +
    size * Math.log(p) +
    k * Math.log(1 - p);
  return Math.exp(logP);
}

/** Sample a standard normal via Box-Muller. */
export function gaussian(rng: Rng): number {
  let u = 0;
  let v = 0;
  while (u === 0) u = rng();
  while (v === 0) v = rng();
  return Math.sqrt(-2 * Math.log(u)) * Math.cos(2 * Math.PI * v);
}

/** Sample a Gamma(shape, scale) via Marsaglia-Tsang. */
export function sampleGamma(shape: number, scale: number, rng: Rng): number {
  if (shape < 1) {
    const u = rng();
    return sampleGamma(1 + shape, scale, rng) * u ** (1 / shape);
  }
  const d = shape - 1 / 3;
  const c = 1 / Math.sqrt(9 * d);
  while (true) {
    let x: number;
    let v: number;
    do {
      x = gaussian(rng);
      v = 1 + c * x;
    } while (v <= 0);
    v = v * v * v;
    const u = rng();
    if (u < 1 - 0.0331 * x ** 4) return d * v * scale;
    if (Math.log(u) < 0.5 * x * x + d * (1 - v + Math.log(v))) return d * v * scale;
  }
}

/**
 * Sample from a Negative Binomial with mean `mu`, dispersion `size` (Gamma-Poisson
 * mixture) — models the overdispersion real baseball counts exhibit.
 */
export function sampleNegBinom(mu: number, size: number, rng: Rng): number {
  if (mu <= 0) return 0;
  const shape = size;
  const scale = mu / size;
  const lambda = sampleGamma(shape, scale, rng);
  return samplePoisson(lambda, rng);
}

/** Sample a Bernoulli trial. */
export function sampleBernoulli(p: number, rng: Rng): boolean {
  return rng() < p;
}
