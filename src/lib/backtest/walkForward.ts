/* ============================================================================
   Walk-forward backtest — the measurement infrastructure that determines whether
   the ensemble actually improves forecasting quality. It is strictly
   chronological and leakage-free BY CONSTRUCTION: the prediction for game i is
   built ONLY from games 0..i-1, then graded against the actual value of game i.
   There is no random train/test split and no future observation can influence an
   earlier prediction.

   Every model (baseline / marginal / pa / ensemble) is scored SEPARATELY so we
   can answer: does the ensemble beat the baseline? It never tunes weights — this
   is evaluation, not optimization (measure first, tune later).

   Reuses the production ensemble (`computeModelEnsemble`) and the existing
   metrics core (`computeBacktest`: Brier, log loss, MAE/RMSE, calibration,
   leakage exclusion). Pure + deterministic given the input series.
   ========================================================================== */

import { project } from "@/lib/prediction/projection";
import { simulate, type SimulationResult } from "@/lib/prediction/simulate";
import { getProp, type DistFamily } from "@/lib/props/catalog";
import { computeModelEnsemble } from "@/lib/models";
import {
  computeBacktest, type ProjectionSnapshot, type GradedResult, type CalibrationBucket,
} from "./metrics";
import { gradePrediction } from "./grader";

export const WALK_FORWARD_VERSION = "1.0.0";

/** A player's chronological (oldest→newest) per-game values for one prop. */
export interface WalkForwardSeries {
  playerId: number;
  propKey: string;
  family: DistFamily;
  values: number[];
  /** ISO game dates, one per value. When absent, synthetic monotonic times are used. */
  dates?: string[];
  /**
   * Optional injected plate-appearance OVER probability for game i given history
   * [0..i-1]. Supplied only for PA-modeled batter props from real box-score rates;
   * absent offline (Model B is then simply not scored — never fabricated).
   */
  paProbOver?: (historyLength: number) => { probOver: number; projection: number } | null;
}

export interface WalkForwardConfig {
  minimumHistory: number;
  /** Threshold per prop. Defaults to the catalog default line. */
  lineFor?: (propKey: string) => number;
  seed?: string;
}

export interface ModelPerformance {
  modelId: string;
  count: number;
  brier: number;
  logLoss: number;
  mae: number | null;
  rmse: number | null;
  /** Expected calibration error (weighted mean |predicted−observed|). Null when unscored. */
  calibrationError: number | null;
}

export interface WalkForwardReport {
  version: string;
  predictions: number; // total graded prediction-games across all models is per-model; this is per (series,game)
  models: ModelPerformance[];
  byProp: Record<string, ModelPerformance[]>;
  byDataQuality: Record<string, ModelPerformance>; // ensemble, by tier
  byDisagreement: Record<string, ModelPerformance>; // ensemble, by severity
  calibrationBins: CalibrationBucket[]; // ensemble
  warnings: string[];
  generatedAt: number;
}

const MODEL_IDS = ["baseline", "marginal", "pa", "ensemble"] as const;
type ScoredModelId = (typeof MODEL_IDS)[number];

interface RawPrediction {
  id: string;
  propKey: string;
  modelId: ScoredModelId;
  line: number;
  probOver: number;
  projection: number;
  actual: number;
  dataQualityTier: "high" | "medium" | "low";
  disagreement: "low" | "medium" | "high";
  capturedAt: string;
  gameStartAt: string;
  featureCutoff: string;
}

function qualityTier(historyLength: number): "high" | "medium" | "low" {
  // Sample-size proxy for data quality (offline we lack the full quality inputs).
  if (historyLength >= 40) return "high";
  if (historyLength >= 25) return "medium";
  return "low";
}

/** Deterministic synthetic timestamps when real dates are absent (still ordered). */
function timesFor(series: WalkForwardSeries, i: number): { data: number; pred: number; start: number } {
  if (series.dates && series.dates[i] && series.dates[i - 1]) {
    const start = Date.parse(series.dates[i]);
    const data = Date.parse(series.dates[i - 1]);
    return { data, pred: start - 3600_000, start }; // predict 1h before first pitch
  }
  // Synthetic: 1 day apart, prediction 1h before the game.
  const base = 1_700_000_000_000;
  const start = base + i * 86_400_000;
  return { data: base + (i - 1) * 86_400_000, pred: start - 3600_000, start };
}

/**
 * Replay every series chronologically and produce one raw prediction per
 * (series, game, model). No future data is used: model inputs are history[0..i-1].
 */
function replay(seriesList: WalkForwardSeries[], config: WalkForwardConfig): RawPrediction[] {
  const out: RawPrediction[] = [];
  const seed = config.seed ?? "wf";
  for (const s of seriesList) {
    const line = config.lineFor?.(s.propKey) ?? getProp(s.propKey)?.defaultLine ?? 0.5;
    for (let i = config.minimumHistory; i < s.values.length; i++) {
      const history = s.values.slice(0, i);
      const actual = s.values[i];
      const t = timesFor(s, i);
      const rowSeed = `${s.playerId}:${s.propKey}:${line}:${i}:${seed}`;

      const proj = project({ series: history, family: s.family });
      const marginalSim: SimulationResult = simulate(
        { ...proj, lambda: proj.shrunkMean, contextMultiplier: 1 }, line, { seed: rowSeed },
      );
      const pa = s.paProbOver?.(history.length) ?? null;
      const paSim: SimulationResult | undefined = pa
        ? ({ ...marginalSim, probOver: pa.probOver, probUnder: 1 - pa.probOver - marginalSim.probPush, mean: pa.projection } as SimulationResult)
        : undefined;

      const me = computeModelEnsemble({
        series: history, family: s.family, line, seed: rowSeed, marginalSim, paSim, modelVersion: "engine",
      });

      const tier = qualityTier(history.length);
      const dis = me.disagreement.severity;
      const common = {
        propKey: s.propKey, line, actual, dataQualityTier: tier, disagreement: dis,
        capturedAt: new Date(t.pred).toISOString(),
        gameStartAt: new Date(t.start).toISOString(),
        featureCutoff: new Date(t.data).toISOString(),
      };
      for (const m of me.models) {
        out.push({ id: `${rowSeed}:${m.id}`, modelId: m.id as ScoredModelId, probOver: m.probOver, projection: m.projection, ...common });
      }
      out.push({ id: `${rowSeed}:ensemble`, modelId: "ensemble", probOver: me.ensemble.rawProbOver, projection: me.ensemble.projection, ...common });
    }
  }
  return out;
}

/** Score one set of raw predictions (already filtered to a model) via computeBacktest. */
function scoreModel(modelId: string, rows: RawPrediction[]): ModelPerformance {
  const snaps: ProjectionSnapshot[] = rows.map((r) => ({
    id: r.id, playerId: 0, gamePk: 0, market: r.propKey, direction: "more", line: r.line,
    probWin: r.probOver, projectedMean: r.projection, confidence: 50, dataQuality: 50,
    modelVersion: modelId, lineupStatus: "unknown", capturedAt: r.capturedAt,
    gameStartAt: r.gameStartAt, featureCutoff: r.featureCutoff,
  }));
  const results: GradedResult[] = rows.map((r) => {
    const g = gradePrediction({ predictionId: r.id, line: r.line, probOver: r.probOver, projection: r.projection, actualValue: r.actual });
    return { id: r.id, actual: r.actual, grade: g.result };
  });
  const report = computeBacktest(snaps, results);
  return {
    modelId,
    count: report.scored,
    brier: report.brierScore,
    logLoss: report.logLoss,
    mae: report.meanAbsoluteError,
    rmse: report.rmse,
    calibrationError: calibrationError(report.calibration, report.scored),
  };
}

function calibrationError(bins: CalibrationBucket[], scored: number): number | null {
  if (scored === 0 || bins.length === 0) return null;
  const ece = bins.reduce((s, b) => s + (b.n / scored) * Math.abs(b.predicted - b.observed), 0);
  return Math.round(ece * 10000) / 10000;
}

/**
 * Run the walk-forward backtest over the provided chronological series. Scores
 * baseline / marginal / (pa when present) / ensemble separately, plus by-prop,
 * by-data-quality-tier and by-disagreement segments and the ensemble calibration
 * bins. Never tunes weights; never fabricates a model that was not run.
 */
export function runWalkForwardBacktest(
  seriesList: WalkForwardSeries[],
  config: WalkForwardConfig,
): WalkForwardReport {
  const warnings: string[] = [];
  if (config.minimumHistory < 5) warnings.push("minimumHistory < 5 — early predictions are unstable.");
  const rows = replay(seriesList, config);

  const presentModels = [...new Set(rows.map((r) => r.modelId))];
  const models = MODEL_IDS.filter((id) => presentModels.includes(id)).map((id) => scoreModel(id, rows.filter((r) => r.modelId === id)));

  // By prop → per model.
  const byProp: Record<string, ModelPerformance[]> = {};
  for (const propKey of [...new Set(rows.map((r) => r.propKey))]) {
    const propRows = rows.filter((r) => r.propKey === propKey);
    byProp[propKey] = MODEL_IDS.filter((id) => propRows.some((r) => r.modelId === id))
      .map((id) => scoreModel(id, propRows.filter((r) => r.modelId === id)));
  }

  // Ensemble-only segment analyses (do disagreement/quality actually track accuracy?).
  const ens = rows.filter((r) => r.modelId === "ensemble");
  const byDisagreement: Record<string, ModelPerformance> = {};
  for (const sev of ["low", "medium", "high"] as const) {
    const g = ens.filter((r) => r.disagreement === sev);
    if (g.length) byDisagreement[sev] = scoreModel("ensemble", g);
  }
  const byDataQuality: Record<string, ModelPerformance> = {};
  for (const tier of ["high", "medium", "low"] as const) {
    const g = ens.filter((r) => r.dataQualityTier === tier);
    if (g.length) byDataQuality[tier] = scoreModel("ensemble", g);
  }
  const ensReport = ens.length ? scoreModel("ensemble", ens) : null;
  void ensReport;

  const calibrationBins = ens.length
    ? computeBacktest(
        ens.map((r) => ({
          id: r.id, playerId: 0, gamePk: 0, market: r.propKey, direction: "more" as const, line: r.line,
          probWin: r.probOver, projectedMean: r.projection, confidence: 50, dataQuality: 50,
          modelVersion: "ensemble", lineupStatus: "unknown" as const, capturedAt: r.capturedAt,
          gameStartAt: r.gameStartAt, featureCutoff: r.featureCutoff,
        })),
        ens.map((r) => ({ id: r.id, actual: r.actual, grade: gradePrediction({ predictionId: r.id, line: r.line, probOver: r.probOver, projection: r.projection, actualValue: r.actual }).result })),
      ).calibration
    : [];

  const totalGames = rows.filter((r) => r.modelId === "ensemble").length;
  if (totalGames < 30) warnings.push(`Only ${totalGames} prediction-games — insufficient sample to claim ensemble superiority.`);

  return {
    version: WALK_FORWARD_VERSION,
    predictions: totalGames,
    models,
    byProp,
    byDataQuality,
    byDisagreement,
    calibrationBins,
    warnings,
    generatedAt: Date.now(),
  };
}
