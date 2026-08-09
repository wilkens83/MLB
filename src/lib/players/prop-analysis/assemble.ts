/* ============================================================================
   PlayerPropAnalysisViewModel assembler. Composes the CANONICAL analysis
   (`runAnalysis`) with the existing scientific engines (independent baseline,
   calibration, prediction-uncertainty, fragility summarizer, Opportunity Engine)
   into the single typed view model the research page renders.

   It REUSES existing engines and never recomputes projections. Every optional
   section degrades to an explicit unavailable state; nothing is fabricated:
     * calibration is unavailable in keyless/no-persistence contexts → calibrated
       probability stays null (raw is never relabeled as calibrated);
     * the decision is the canonical Opportunity Engine status read server-side;
     * percentiles require a reference population and otherwise report N/A.
   ========================================================================== */

import { runAnalysis, type AnalysisPayload, MODEL_VERSION } from "@/lib/mlb/analysis";
import { getCurrentMlbSeason } from "@/lib/mlb/api";
import { hitRate, clearsLine, type Window } from "@/lib/analytics/hitRate";
import { simulate } from "@/lib/prediction/simulate";
import { independentBaseline, baselineForSide } from "@/lib/prizepicks/opportunity/baselines";
import { unavailableCalibration } from "@/lib/prizepicks/opportunity/calibration";
import { predictionUncertainty } from "@/lib/prizepicks/opportunity/uncertainty";
import { summarizeFragility, type ScenarioProbability } from "@/lib/prizepicks/opportunity/fragility";
import { assessOpportunity } from "@/lib/prizepicks/opportunity/engine";
import { staticParkProvider } from "@/lib/providers/park";
import { getPitcherArsenal } from "@/lib/providers/arsenal";
import type { StatcastBatter, StatcastPitcher } from "@/lib/domain/models";
import { getMarketConfig, type MarketAnalysisConfig } from "./market-config";
import { labelForCode } from "./reason-labels";
import type {
  PlayerPropAnalysisViewModel, VmHistoryPoint, VmHistoricalHitRate, VmMetric,
  VmScientific, VmDecision, VmConditions, VmMatchup, VmPercentileRow, VmPitchType, VmProvenance,
} from "./types";

export interface PropAnalysisRequest {
  playerId: number;
  market: string;
  line?: number;
  window?: number;
  lineSource?: "prizepicks" | "manual" | "default";
  lineCapturedAt?: string;
}

const round = (x: number, d = 1) => {
  const f = 10 ** d;
  return Math.round(x * f) / f;
};

/* ------------------------------- history ---------------------------------- */

export function buildHistory(payload: AnalysisPayload, line: number, window: number): VmHistoryPoint[] {
  const samples = payload.samples.slice(Math.max(0, payload.samples.length - window));
  const points: VmHistoryPoint[] = samples.map((s) => {
    const c = clearsLine(s.value, line, "over");
    return {
      date: s.date,
      opponent: s.opponent,
      isHome: s.isHome,
      value: s.value,
      result: c === null ? "push" : c ? "over" : "under",
    };
  });
  // Upcoming game placeholder (next, unplayed) — value unknown, never fabricated.
  const opp = payload.opponent;
  if (opp?.opponentTeam) {
    points.push({ opponent: opp.opponentTeam, value: null, result: null, upcoming: true });
  }
  return points;
}

/* ------------------------- historical hit rates --------------------------- */

export function buildHitRates(payload: AnalysisPayload, line: number): VmHistoricalHitRate[] {
  const series = payload.samples.map((s) => s.value);
  const windows: { key: VmHistoricalHitRate["window"]; n: Window }[] = [
    { key: "L5", n: 5 }, { key: "L10", n: 10 }, { key: "L20", n: 20 }, { key: "Season", n: "season" },
  ];
  return windows.map(({ key, n }) => {
    const r = hitRate(series, line, "over", n);
    // decided games only (pushes excluded) for the rate denominator
    const slice = series.slice(Math.max(0, series.length - (n === "season" ? series.length : n)));
    const decided = slice.filter((v) => clearsLine(v, line, "over") !== null).length;
    return { window: key, games: r.games, hits: r.hits, overRate: decided === 0 ? null : r.hits / decided };
  });
}

/* ----------------------------- header metrics ----------------------------- */

function metric(key: string, label: string, value: number | null | undefined, format: VmMetric["format"], extra?: Partial<VmMetric>): VmMetric {
  return { key, label, value: value ?? null, format, ...extra };
}

function headerMetrics(payload: AnalysisPayload, config: MarketAnalysisConfig): VmMetric[] {
  const out: VmMetric[] = [];
  const a = payload.analysis;
  const series = payload.samples.map((s) => s.value);
  const seasonAvg = series.length ? series.reduce((s, v) => s + v, 0) / series.length : null;

  // Projection (charted stat) with a REAL delta vs season average of that stat.
  if (a) {
    const proj = a.projection.lambda;
    out.push(metric("projection", `Proj ${config.shortLabel}`, round(proj, 1), "one", {
      delta: seasonAvg !== null ? round(proj - seasonAvg, 1) : undefined,
      deltaGood: "up",
    }));
  }

  // Statcast season profile (values are already in percent units — no ×100; no
  // fabricated deltas — season values only).
  if (config.playerType === "pitcher" && payload.statcast.pitcher) {
    const p = payload.statcast.pitcher;
    out.push(metric("kPct", "K%", p.kPct ?? null, "pct"));
    out.push(metric("bbPct", "BB%", p.bbPct ?? null, "pct"));
    out.push(metric("whiffPct", "Whiff%", p.whiffPct ?? null, "pct"));
    out.push(metric("xwoba", "xwOBA", p.xwoba ?? null, "one"));
  } else if (config.playerType === "batter" && payload.statcast.batter) {
    const b = payload.statcast.batter;
    out.push(metric("battingAvg", "AVG", b.battingAvg ?? null, "one"));
    out.push(metric("kPct", "K%", b.kPct ?? null, "pct"));
    out.push(metric("barrelPct", "Barrel%", b.barrelPct ?? null, "pct"));
    out.push(metric("xwoba", "xwOBA", b.xwoba ?? null, "one"));
  }
  return out;
}

/* ------------------------------ scientific -------------------------------- */

function fragilityScenarios(payload: AnalysisPayload, line: number, base: number): ScenarioProbability[] {
  const a = payload.analysis;
  if (!a) return [];
  const lambda = a.projection.lambda;
  const seed = `${payload.player?.id}:${a.prop.key}:${line}`;
  const perturb = [0.94, 0.97, 1.03, 1.06];
  const scenarios: ScenarioProbability[] = [];
  for (const m of perturb) {
    const sim = simulate({ ...a.projection, lambda: lambda * m }, line, { seed: `${seed}:${m}` });
    scenarios.push({
      label: `${m < 1 ? "-" : "+"}${Math.round(Math.abs(1 - m) * 100)}% rate`,
      assumption: "projection rate",
      probability: sim.probOver,
    });
  }
  // include the base itself so range is meaningful
  scenarios.push({ label: "base", assumption: "projection rate", probability: base });
  return scenarios;
}

export function buildScientific(payload: AnalysisPayload, line: number): VmScientific | null {
  const a = payload.analysis;
  if (!a) return null;
  const sim = a.simulation;
  const rawMore = sim.probOver;
  const rawLess = sim.probUnder;

  // Calibration is unavailable without a persisted fit → calibrated stays null.
  const cal = unavailableCalibration();
  const calMore = cal.available ? cal.apply(rawMore) : null;
  const calLess = cal.available ? cal.apply(rawLess) : null;

  const decMore = calMore ?? rawMore;
  const decLess = calLess ?? rawLess;
  const side: "more" | "less" = decMore >= decLess ? "more" : "less";
  const selected = Math.max(decMore, decLess);

  const baseline = independentBaseline(a.prop.key, line);
  const baselineProb = baselineForSide(baseline, side) ?? null;
  // Model advantage requires calibrated probability (never raw-vs-baseline).
  const modelAdvantagePp = cal.available && baselineProb !== null ? round((selected - baselineProb) * 100, 1) : null;

  // Fragility from the pure summarizer over re-simulated scenarios.
  const scenarios = fragilityScenarios(payload, line, side === "more" ? rawMore : rawLess);
  const frag = scenarios.length ? summarizeFragility(side === "more" ? rawMore : rawLess, scenarios) : null;

  // Uncertainty decomposition (sampling noise vs plausible-assumption swing).
  const unc = predictionUncertainty({
    probability: selected,
    iterations: sim.iterations,
    probabilityRange: frag?.probabilityRange ?? 0,
    dataCompleteness: (payload.dataQuality?.score ?? 0) / 100,
  });

  // Projection band from the simulation CI (labeled honestly, not P25–P75).
  const band: [number, number] = sim.ci80;

  return {
    rawProbabilityMore: round(rawMore, 3),
    rawProbabilityLess: round(rawLess, 3),
    calibratedProbabilityMore: calMore,
    calibratedProbabilityLess: calLess,
    calibrationAvailable: cal.available,
    calibrationVersion: cal.available ? cal.version : undefined,
    baselineProbability: baselineProb !== null ? round(baselineProb, 3) : null,
    modelAdvantagePp,
    side,
    projection: {
      mean: round(sim.mean, 1),
      median: round(sim.median, 1),
      band: [round(band[0], 1), round(band[1], 1)],
      bandLabel: "P10–P90",
    },
    dataQuality: payload.dataQuality?.score ?? 0,
    fragilityScore: frag ? Math.round(frag.fragilityScore) : null,
    fragilityLevel: frag?.fragilityLevel ?? null,
    uncertaintyHalfWidth95: unc.monteCarloHalfWidth95,
    modelInputUncertainty: unc.modelInputUncertainty,
    trainingSupport: (payload.samples.length >= 5 ? "IN-DISTRIBUTION" : "UNKNOWN"),
    modelLifecycle: "RESEARCH_ONLY",
    modelVersion: MODEL_VERSION,
  };
}

/* ------------------------------- decision --------------------------------- */

function buildDecision(
  payload: AnalysisPayload,
  sci: VmScientific | null,
  line: number,
  hasActiveLine: boolean,
): VmDecision {
  if (!hasActiveLine) {
    return {
      status: "NO_ACTIVE_LINE",
      reasons: ["No confirmed PrizePicks/market line — research analysis only."],
      risks: [],
      fromCanonicalAssessment: false,
    };
  }
  const a = payload.analysis;
  if (!a || !sci) {
    return { status: "UNAVAILABLE", reasons: ["Projection unavailable."], risks: [], fromCanonicalAssessment: false };
  }

  const opp = payload.opponent;
  // Read the CANONICAL Opportunity Engine verdict with honest, server-derived facts.
  const assessment = assessOpportunity({
    lineSnapshotId: `live:${payload.player?.id}:${a.prop.key}:${line}`,
    playerId: payload.player?.id,
    gamePk: opp?.gamePk,
    market: a.prop.key,
    line,
    isPitcher: a.prop.category === "pitcher",
    rawProbabilityMore: a.simulation.probOver,
    rawProbabilityLess: a.simulation.probUnder,
    rawProbabilityPush: a.simulation.probPush,
    projectionMean: a.simulation.mean,
    projectionMedian: a.simulation.median,
    dataQuality: sci.dataQuality,
    volatility: sci.fragilityScore ?? 50,
    fragility: sci.fragilityScore ?? 50,
    uncertaintyLow: a.simulation.ci80[0],
    uncertaintyHigh: a.simulation.ci80[1],
    trainingSupport: sci.trainingSupport === "IN-DISTRIBUTION" ? 1 : 0,
    fragilityLevel: sci.fragilityLevel ?? undefined,
    calibration: unavailableCalibration(),
    // Trusted scientific facts (defaults: research-only, nothing validated/persisted).
    marketValidationState: "RESEARCH_ONLY",
    calibrationDegraded: false,
    featureDriftExceeded: false,
    outsideTrainingSupport: sci.trainingSupport === "OUTSIDE-SUPPORT",
    requiredSimDependencyUnavailable: false,
    playerResolved: !!payload.player,
    gameResolved: !!opp?.gamePk,
    marketSupported: true,
    lineupRequired: a.prop.category === "batter",
    lineupConfirmed: opp?.lineupConfirmed ?? false,
    pitcherMateriallyRelevant: a.prop.category === "batter",
    starterConfirmed: opp?.starterConfirmed ?? false,
    gameStarted: false,
    snapshotBeforeEvent: false,
    featureCutoffBeforeStart: false,
    pregameSnapshotExists: false,
    modelVersionApproved: false,
    modelVersion: MODEL_VERSION,
    featureVersion: "live",
  });

  const reasons = assessment.reasonCodes.map(labelForCode);
  const risks = [
    ...assessment.scientificVetoes.map((v) => v.message),
    ...payload.warnings.filter((w) => w.severity !== "info").map((w) => w.message),
  ];
  return {
    status: assessment.status,
    reasons: [...new Set(reasons)].slice(0, 6),
    risks: [...new Set(risks)].slice(0, 6),
    fromCanonicalAssessment: true,
  };
}

/* ------------------------------ conditions -------------------------------- */

function buildConditions(payload: AnalysisPayload): VmConditions | null {
  const opp = payload.opponent;
  if (!opp?.venueName) return null;
  const pf = staticParkProvider.getFactor(opp.venueName);
  const hasFactors = pf.runs !== 1 || pf.hr !== 1 || pf.hits !== 1;
  const classification: VmConditions["classification"] = !hasFactors
    ? "Neutral"
    : pf.runs > 1.02 ? "Hitter Friendly" : pf.runs < 0.98 ? "Pitcher Friendly" : "Neutral";
  return {
    venueName: opp.venueName,
    weatherAvailable: false, // no wired weather feed → reported unavailable, not neutral
    park: {
      runs: hasFactors ? pf.runs : null,
      hr: hasFactors ? pf.hr : null,
      hits: hasFactors ? pf.hits : null,
    },
    classification: hasFactors ? classification : undefined,
  };
}

/* ------------------------------- matchup ---------------------------------- */

const PCT_METRIC_LABELS: Record<string, string> = {
  battingAvg: "BA", bbPct: "BB%", kPct: "K%", whiffPct: "Whiff%", xwoba: "xwOBA",
  barrelPct: "Barrel%", hardHitPct: "HardHit%", barrelPctAllowed: "Barrel%", hardHitPctAllowed: "HardHit%",
};

function statVal(sc: StatcastBatter | StatcastPitcher | null | undefined, key: string): number | null {
  if (!sc) return null;
  const v = (sc as unknown as Record<string, number | undefined>)[key];
  return v ?? null;
}

export function buildMatchup(payload: AnalysisPayload, config: MarketAnalysisConfig): VmMatchup {
  const player = config.playerType === "pitcher" ? payload.statcast.pitcher : payload.statcast.batter;
  const opponent = config.playerType === "pitcher" ? payload.statcast.batter : payload.statcast.pitcher;
  // For pitcher markets the "opponent" batter profile is the opposing lineup —
  // not modeled here as a single row, so we show the pitcher's own row + note.
  if (!player) {
    return { available: false, referenceSize: null, rows: [], note: "Statcast profile unavailable for this player." };
  }
  const rows: VmPercentileRow[] = config.matchupMetrics.map((key) => ({
    metric: key,
    label: PCT_METRIC_LABELS[key] ?? key,
    playerValue: statVal(player, key),
    // Percentiles require a reference population we do not fetch here → null (N/A).
    playerPercentile: null,
    opponentValue: statVal(opponent, key),
    opponentPercentile: null,
    edge: null,
  })).filter((r) => r.playerValue !== null || r.opponentValue !== null);
  return {
    available: rows.length > 0,
    referenceSize: null,
    rows,
    note: "Raw Statcast values shown. Percentile ranks require a season reference population (not loaded) and are marked N/A.",
  };
}

/* ------------------------------ pitch types ------------------------------- */

async function buildPitchTypes(payload: AnalysisPayload, config: MarketAnalysisConfig): Promise<VmPitchType[]> {
  if (config.playerType !== "pitcher" || !payload.player) return [];
  const arsenal = await getPitcherArsenal(payload.player.id).catch(() => null);
  if (!arsenal) return [];
  return arsenal.pitches.map((p) => ({
    pitchType: p.pitchType,
    pitchName: p.pitchName,
    usage: p.usage ?? null,
    velo: null,
    whiffPct: p.whiffPct ?? null,
    baAllowed: p.baAllowed ?? null,
    slgAllowed: p.slgAllowed ?? null,
    xwobaAllowed: p.xwobaAllowed ?? null,
  }));
}

/* ------------------------------- assemble --------------------------------- */

export async function assemblePropAnalysis(req: PropAnalysisRequest): Promise<PlayerPropAnalysisViewModel> {
  const season = getCurrentMlbSeason();
  const config = getMarketConfig(req.market);
  if (!config) {
    // Unsupported market: return a minimal, honest error view keyed to a default.
    const fallback = getMarketConfig("hits")!;
    return emptyViewModel(fallback, season, "PLAYER_UNAVAILABLE", "Unsupported market.");
  }
  const window = req.window && config.allowedWindows.includes(req.window) ? req.window : 10;
  const line = req.line ?? config.defaultLine;
  const lineSource = req.lineSource ?? "default";
  const hasActiveLine = lineSource !== "default";

  const payload = await runAnalysis({ playerId: req.playerId, propKey: req.market, line });

  if (!payload.player) {
    return emptyViewModel(config, season, "PLAYER_UNAVAILABLE", "Player could not be resolved.");
  }

  const provenance: VmProvenance = {
    dataAsOf: payload.lastUpdated,
    modelVersion: MODEL_VERSION,
    sources: (payload.provenance?.sources ?? []).map((s) => ({ name: s.name, available: s.available })),
    lineCapturedAt: req.lineCapturedAt,
    season,
  };

  if (payload.error === "no_series_data" || payload.samples.length === 0) {
    return {
      ...emptyViewModel(config, season, "NO_SERIES_DATA", "No game-log data for this market."),
      player: toVmPlayer(payload),
      game: toVmGame(payload),
      provenance,
    };
  }

  const sci = buildScientific(payload, line);
  const [pitchTypes] = await Promise.all([buildPitchTypes(payload, config)]);

  return {
    ok: true,
    status: "OK",
    config,
    window,
    player: toVmPlayer(payload),
    game: toVmGame(payload),
    line: { value: line, source: lineSource, capturedAt: req.lineCapturedAt },
    headerMetrics: headerMetrics(payload, config),
    history: buildHistory(payload, line, window),
    historicalHitRates: buildHitRates(payload, line),
    scientific: sci,
    decision: buildDecision(payload, sci, line, hasActiveLine),
    conditions: buildConditions(payload),
    matchup: buildMatchup(payload, config),
    splits: [], // populated by the splits endpoint on demand (kept lean here)
    pitchTypes,
    provenance,
    warnings: payload.warnings.map((w) => w.message),
  };
}

function toVmPlayer(payload: AnalysisPayload): PlayerPropAnalysisViewModel["player"] {
  const p = payload.player!;
  return {
    id: p.id, name: p.name, position: p.position, team: p.team,
    bats: p.bats, throws: p.throws, isPitcher: p.position === "P",
  };
}

function toVmGame(payload: AnalysisPayload): PlayerPropAnalysisViewModel["game"] {
  const o = payload.opponent;
  if (!o) return null;
  return {
    gamePk: o.gamePk,
    venueName: o.venueName,
    opponentTeam: o.opponentTeam,
    starterConfirmed: o.starterConfirmed,
    lineupConfirmed: o.lineupConfirmed,
  };
}

function emptyViewModel(
  config: MarketAnalysisConfig,
  season: number,
  status: PlayerPropAnalysisViewModel["status"],
  warning: string,
): PlayerPropAnalysisViewModel {
  return {
    ok: status === "OK",
    status,
    config,
    window: 10,
    player: null,
    game: null,
    line: { value: config.defaultLine, source: "default" },
    headerMetrics: [],
    history: [],
    historicalHitRates: [],
    scientific: null,
    decision: { status: "UNAVAILABLE", reasons: [warning], risks: [], fromCanonicalAssessment: false },
    conditions: null,
    matchup: { available: false, referenceSize: null, rows: [], note: warning },
    splits: [],
    pitchTypes: [],
    provenance: { dataAsOf: Date.now(), modelVersion: MODEL_VERSION, sources: [], season },
    warnings: [warning],
  };
}
