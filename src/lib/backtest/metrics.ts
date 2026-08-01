/* ============================================================================
   Backtesting / model-validation metrics. Operates on IMMUTABLE pregame
   projection snapshots joined to official graded results. Strictly
   chronological: any snapshot whose feature cutoff is after the game start is
   treated as temporal leakage and excluded (never scored). Pure + deterministic.

   A visually impressive projection is not a validated one — these metrics
   (Brier, log loss, calibration, MAE/RMSE, by-segment hit rate) are how we tell.
   No result is fabricated: metrics are computed only from supplied graded pairs.
   ========================================================================== */

export type PickDirection = "more" | "less";
export type Grade = "win" | "loss" | "push";
export type LineupStatus = "confirmed" | "projected" | "unknown";

export interface ProjectionSnapshot {
  id: string;
  playerId: number;
  gamePk: number;
  market: string;
  direction: PickDirection;
  line: number;
  /** Model probability that the PICKED side wins (0..1). */
  probWin: number;
  /** Projected mean of the underlying stat, for MAE/RMSE (optional). */
  projectedMean?: number;
  confidence: number; // 0..100
  dataQuality: number; // 0..100
  modelVersion: string;
  lineupStatus: LineupStatus;
  capturedAt: string; // ISO
  gameStartAt?: string; // ISO
  featureCutoff?: string; // ISO — latest data timestamp allowed into the projection
}

export interface GradedResult {
  id: string;
  /** Actual observed value of the underlying stat. */
  actual: number;
  /** Grade relative to the picked direction. */
  grade: Grade;
}

export interface Segment {
  key: string;
  n: number;
  wins: number;
  losses: number;
  pushes: number;
  hitRate: number;
  brier: number;
  logLoss: number;
}

export interface CalibrationBucket {
  bucket: string; // e.g. "0.5-0.6"
  n: number;
  predicted: number; // mean predicted probability
  observed: number; // observed hit rate
}

export interface BacktestReport {
  n: number;
  scored: number; // non-push, non-leaked
  wins: number;
  losses: number;
  pushes: number;
  leakageExcluded: number;
  unmatched: number;
  hitRate: number;
  brierScore: number;
  logLoss: number;
  meanAbsoluteError: number | null;
  rmse: number | null;
  avgConfidence: number;
  calibration: CalibrationBucket[];
  byMarket: Segment[];
  byProbabilityBucket: Segment[];
  byConfidenceBucket: Segment[];
  byLineupStatus: Segment[];
  byModelVersion: Segment[];
  /** Even-money equity proxy (win +1, loss -1) — a variance/drawdown sense, not real odds. */
  maxDrawdown: number;
  warnings: string[];
}

const clampP = (p: number) => Math.min(1 - 1e-9, Math.max(1e-9, p));

interface Scored {
  snap: ProjectionSnapshot;
  y: number; // 1 win, 0 loss
  p: number; // clamped predicted prob
  actual: number;
}

function segment(key: string, rows: Scored[]): Segment {
  const wins = rows.filter((r) => r.y === 1).length;
  const losses = rows.length - wins;
  const brier = rows.length ? rows.reduce((s, r) => s + (r.p - r.y) ** 2, 0) / rows.length : 0;
  const logLoss = rows.length
    ? -rows.reduce((s, r) => s + (r.y * Math.log(r.p) + (1 - r.y) * Math.log(1 - r.p)), 0) / rows.length
    : 0;
  return {
    key,
    n: rows.length,
    wins,
    losses,
    pushes: 0,
    hitRate: rows.length ? wins / rows.length : 0,
    brier: round(brier),
    logLoss: round(logLoss),
  };
}

function groupBy(rows: Scored[], keyFn: (r: Scored) => string): Segment[] {
  const map = new Map<string, Scored[]>();
  for (const r of rows) {
    const k = keyFn(r);
    (map.get(k) ?? map.set(k, []).get(k)!).push(r);
  }
  return [...map.entries()].map(([k, rs]) => segment(k, rs)).sort((a, b) => b.n - a.n);
}

function probBucket(p: number): string {
  const lo = Math.min(0.9, Math.floor(p * 10) / 10);
  return `${lo.toFixed(1)}-${(lo + 0.1).toFixed(1)}`;
}
function confBucket(c: number): string {
  const lo = Math.min(90, Math.floor(c / 10) * 10);
  return `${lo}-${lo + 10}`;
}
function round(x: number, d = 4): number {
  const f = 10 ** d;
  return Math.round(x * f) / f;
}

export function computeBacktest(
  snapshots: ProjectionSnapshot[],
  results: GradedResult[],
): BacktestReport {
  const byId = new Map(results.map((r) => [r.id, r]));
  const warnings: string[] = [];
  const scored: Scored[] = [];
  let pushes = 0;
  let leakageExcluded = 0;
  let unmatched = 0;

  for (const snap of snapshots) {
    // Temporal-leakage guard: features must be cut off no later than game start.
    if (snap.featureCutoff && snap.gameStartAt && Date.parse(snap.featureCutoff) > Date.parse(snap.gameStartAt)) {
      leakageExcluded++;
      continue;
    }
    const res = byId.get(snap.id);
    if (!res) {
      unmatched++;
      continue;
    }
    if (res.grade === "push") {
      pushes++;
      continue;
    }
    scored.push({ snap, y: res.grade === "win" ? 1 : 0, p: clampP(snap.probWin), actual: res.actual });
  }

  if (leakageExcluded > 0) warnings.push(`${leakageExcluded} snapshot(s) excluded for temporal leakage (feature cutoff after game start).`);
  if (unmatched > 0) warnings.push(`${unmatched} snapshot(s) had no graded result and were skipped.`);
  if (scored.length < 30) warnings.push(`Only ${scored.length} graded picks — too small a sample to claim profitability or calibration.`);

  const wins = scored.filter((r) => r.y === 1).length;
  const losses = scored.length - wins;
  const brier = scored.length ? scored.reduce((s, r) => s + (r.p - r.y) ** 2, 0) / scored.length : 0;
  const logLoss = scored.length
    ? -scored.reduce((s, r) => s + (r.y * Math.log(r.p) + (1 - r.y) * Math.log(1 - r.p)), 0) / scored.length
    : 0;

  // MAE / RMSE (only where a projected mean exists).
  const withMean = scored.filter((r) => r.snap.projectedMean !== undefined);
  const mae = withMean.length ? withMean.reduce((s, r) => s + Math.abs(r.snap.projectedMean! - r.actual), 0) / withMean.length : null;
  const rmse = withMean.length ? Math.sqrt(withMean.reduce((s, r) => s + (r.snap.projectedMean! - r.actual) ** 2, 0) / withMean.length) : null;

  // Calibration buckets.
  const calMap = new Map<string, Scored[]>();
  for (const r of scored) {
    const b = probBucket(r.p);
    (calMap.get(b) ?? calMap.set(b, []).get(b)!).push(r);
  }
  const calibration: CalibrationBucket[] = [...calMap.entries()]
    .map(([bucket, rs]) => ({
      bucket,
      n: rs.length,
      predicted: round(rs.reduce((s, r) => s + r.p, 0) / rs.length, 3),
      observed: round(rs.filter((r) => r.y === 1).length / rs.length, 3),
    }))
    .sort((a, b) => a.bucket.localeCompare(b.bucket));

  // Even-money equity proxy for a drawdown sense (chronological by capturedAt).
  const ordered = [...scored].sort((a, b) => Date.parse(a.snap.capturedAt) - Date.parse(b.snap.capturedAt));
  let equity = 0;
  let peak = 0;
  let maxDrawdown = 0;
  for (const r of ordered) {
    equity += r.y === 1 ? 1 : -1;
    peak = Math.max(peak, equity);
    maxDrawdown = Math.max(maxDrawdown, peak - equity);
  }

  return {
    n: snapshots.length,
    scored: scored.length,
    wins,
    losses,
    pushes,
    leakageExcluded,
    unmatched,
    hitRate: scored.length ? round(wins / scored.length, 4) : 0,
    brierScore: round(brier),
    logLoss: round(logLoss),
    meanAbsoluteError: mae === null ? null : round(mae, 3),
    rmse: rmse === null ? null : round(rmse, 3),
    avgConfidence: scored.length ? round(scored.reduce((s, r) => s + r.snap.confidence, 0) / scored.length, 1) : 0,
    calibration,
    byMarket: groupBy(scored, (r) => r.snap.market),
    byProbabilityBucket: groupBy(scored, (r) => probBucket(r.p)).sort((a, b) => a.key.localeCompare(b.key)),
    byConfidenceBucket: groupBy(scored, (r) => confBucket(r.snap.confidence)).sort((a, b) => a.key.localeCompare(b.key)),
    byLineupStatus: groupBy(scored, (r) => r.snap.lineupStatus),
    byModelVersion: groupBy(scored, (r) => r.snap.modelVersion),
    maxDrawdown,
    warnings,
  };
}
