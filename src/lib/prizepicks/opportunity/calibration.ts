/* ============================================================================
   Probability calibration. The raw Monte-Carlo probability is NOT a validated
   probability — it must be mapped through a calibration model fitted from
   forward-graded outcomes before it drives a decision. This module reuses the
   backtest calibration buckets (`CalibrationBucket`) as the fitted reliability
   curve and exposes an EXPLICIT "unavailable" state: when no trustworthy
   calibration exists, the caller must NOT substitute the raw probability as if
   it were validated — the opportunity degrades instead.

   Monotone (isotonic-style) interpolation over bucket midpoints keeps the
   mapping order-preserving. Pure + deterministic.
   ========================================================================== */

import type { CalibrationBucket } from "@/lib/backtest/metrics";

export interface CalibrationModel {
  available: boolean;
  version: string;
  /** Map a raw probability to a calibrated one. Identity when unavailable. */
  apply(raw: number): number;
  /** Number of graded samples behind the fit (0 when unavailable). */
  sampleSize: number;
  reason?: string;
}

/** The explicit UNAVAILABLE model — apply() is identity, but `available` is false
    so callers refuse to treat the output as a validated probability. */
export function unavailableCalibration(reason = "no calibration fitted for this market/version"): CalibrationModel {
  return { available: false, version: "none", apply: (raw) => raw, sampleSize: 0, reason };
}

export interface FitOptions {
  version: string;
  /** Minimum total graded samples required to trust the fit. */
  minSamples?: number;
  /** Minimum populated buckets required. */
  minBuckets?: number;
}

function midpoint(bucketLabel: string): number {
  const m = bucketLabel.match(/^([\d.]+)-([\d.]+)$/);
  if (!m) return NaN;
  return (Number(m[1]) + Number(m[2])) / 2;
}

/**
 * Fit a calibration model from reliability buckets. Returns an UNAVAILABLE model
 * when the evidence is too thin to trust — never a silent identity that pretends
 * to be validated.
 */
export function fitCalibration(buckets: CalibrationBucket[], opts: FitOptions): CalibrationModel {
  const minSamples = opts.minSamples ?? 100;
  const minBuckets = opts.minBuckets ?? 3;

  const points = buckets
    .filter((b) => b.n > 0 && Number.isFinite(midpoint(b.bucket)))
    .map((b) => ({ x: midpoint(b.bucket), y: b.observed, n: b.n }))
    .sort((a, b) => a.x - b.x);

  const total = points.reduce((s, p) => s + p.n, 0);
  if (points.length < minBuckets || total < minSamples) {
    return unavailableCalibration(
      `insufficient calibration evidence (${points.length} buckets, ${total} samples < ${minBuckets}/${minSamples})`,
    );
  }

  // Enforce monotonicity (pool-adjacent-violators, sample-weighted) so a higher
  // raw probability never calibrates below a lower one.
  const iso = poolAdjacentViolators(points);

  return {
    available: true,
    version: opts.version,
    sampleSize: total,
    apply(raw: number): number {
      const x = Math.min(1, Math.max(0, raw));
      // Piecewise-linear interpolation over the monotone calibration points,
      // clamped at the endpoints.
      if (x <= iso[0].x) return clampUnit(iso[0].y);
      if (x >= iso[iso.length - 1].x) return clampUnit(iso[iso.length - 1].y);
      for (let i = 1; i < iso.length; i++) {
        if (x <= iso[i].x) {
          const a = iso[i - 1], b = iso[i];
          const t = (x - a.x) / (b.x - a.x || 1);
          return clampUnit(a.y + t * (b.y - a.y));
        }
      }
      return clampUnit(x);
    },
  };
}

const clampUnit = (n: number) => Math.min(1, Math.max(0, n));

/** Sample-weighted pool-adjacent-violators → a non-decreasing calibration curve. */
function poolAdjacentViolators(points: { x: number; y: number; n: number }[]): { x: number; y: number }[] {
  const blocks = points.map((p) => ({ x: p.x, sumY: p.y * p.n, w: p.n }));
  let i = 0;
  while (i < blocks.length - 1) {
    const meanI = blocks[i].sumY / blocks[i].w;
    const meanNext = blocks[i + 1].sumY / blocks[i + 1].w;
    if (meanI > meanNext) {
      // Violation — merge the two blocks and back up.
      blocks[i].sumY += blocks[i + 1].sumY;
      blocks[i].w += blocks[i + 1].w;
      blocks[i].x = blocks[i + 1].x; // right edge of the pooled block
      blocks.splice(i + 1, 1);
      if (i > 0) i--;
    } else i++;
  }
  // Re-expand: map each original x to its pooled mean; keep endpoints for interp.
  const out: { x: number; y: number }[] = [];
  let bi = 0;
  let consumed = 0;
  for (const p of points) {
    while (bi < blocks.length - 1 && consumed >= blocks[bi].w) { consumed = 0; bi++; }
    out.push({ x: p.x, y: blocks[bi].sumY / blocks[bi].w });
    consumed++;
  }
  return out;
}
