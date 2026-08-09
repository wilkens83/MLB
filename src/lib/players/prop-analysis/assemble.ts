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
import { DEFAULT_DECISION_POLICY } from "@/lib/prizepicks/decision/policy";
import { staticParkProvider } from "@/lib/providers/park";
import { getPitcherArsenal } from "@/lib/providers/arsenal";
import { getBatterPopulation, getPitcherPopulation, savantStatcastProvider } from "@/lib/providers/statcast";
import { getProjectedLineup, getPlayerSplits, type PlayerSplit } from "@/lib/mlb/api";
import type { StatcastBatter, StatcastPitcher } from "@/lib/domain/models";
import { getMarketConfig, type MarketAnalysisConfig } from "./market-config";
import { labelForCode } from "./reason-labels";
import { buildPercentileRows, aggregateLineupProfile } from "./percentiles";
import type {
  PlayerPropAnalysisViewModel, VmHistoryPoint, VmHistoricalHitRate, VmMetric,
  VmScientific, VmDecision, VmConditions, VmMatchup, VmPitchType, VmProvenance,
  VmOpponentContext, VmSplit,
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

  // Projection band from the simulation CI (P10–P90) + the interquartile band
  // (P25–P75) derived from the discrete distribution when available.
  const band: [number, number] = sim.ci80;
  const iqr = quantilesFromDistribution(sim.distribution, [0.25, 0.75]);
  // Volatility = coefficient of variation of the projection, scaled to 0..100.
  const volatility = sim.mean > 0 ? Math.min(100, Math.round((sim.stdDev / sim.mean) * 100)) : 0;

  return {
    rawProbabilityMore: round(rawMore, 3),
    rawProbabilityLess: round(rawLess, 3),
    calibratedProbabilityMore: calMore,
    calibratedProbabilityLess: calLess,
    calibrationAvailable: cal.available,
    baselineProbability: baselineProb !== null ? round(baselineProb, 3) : null,
    modelAdvantagePp,
    policyThresholdPct: round(DEFAULT_DECISION_POLICY.minimumSelectedSideProbability * 100, 0),
    side,
    projection: {
      mean: round(sim.mean, 1),
      median: round(sim.median, 1),
      band: [round(band[0], 1), round(band[1], 1)],
      bandLabel: "P10–P90",
      iqr: iqr ? [round(iqr[0], 0), round(iqr[1], 0)] : null,
    },
    dataQuality: payload.dataQuality?.score ?? 0,
    volatility,
    fragilityScore: frag ? Math.round(frag.fragilityScore) : null,
    fragilityLevel: frag?.fragilityLevel ?? null,
    uncertaintyHalfWidth95: unc.monteCarloHalfWidth95,
    modelInputUncertainty: unc.modelInputUncertainty,
    trainingSupport: (payload.samples.length >= 5 ? "IN-DISTRIBUTION" : "UNKNOWN"),
    modelLifecycle: "RESEARCH_ONLY",
    modelVersion: MODEL_VERSION,
    featureVersion: "live",
    calibrationVersion: cal.available ? cal.version : null,
  };
}

/** Interpolate quantiles from a discrete probability distribution (or null). */
function quantilesFromDistribution(
  dist: { value: number; probability: number }[],
  qs: number[],
): number[] | null {
  if (dist.length === 0) return null;
  const sorted = [...dist].sort((a, b) => a.value - b.value);
  const total = sorted.reduce((s, d) => s + d.probability, 0);
  if (total <= 0) return null;
  const out: number[] = [];
  for (const q of qs) {
    let cum = 0;
    let picked = sorted[sorted.length - 1].value;
    for (const d of sorted) {
      cum += d.probability / total;
      if (cum >= q) { picked = d.value; break; }
    }
    out.push(picked);
  }
  return out;
}

/* ------------------------------- decision --------------------------------- */

export function buildDecision(
  payload: AnalysisPayload,
  sci: VmScientific | null,
  line: number,
  hasActiveLine: boolean,
): VmDecision {
  if (!hasActiveLine) {
    return {
      status: "NO_ACTIVE_LINE",
      reasons: ["Research analysis only — the projection stands, but no market verdict is issued without a line."],
      risks: [],
      nextReview: "Re-evaluate when a PrizePicks/market line is captured for this player + market.",
      fromCanonicalAssessment: false,
    };
  }
  const a = payload.analysis;
  if (!a || !sci) {
    return {
      status: "UNAVAILABLE",
      reasons: [],
      risks: ["Projection unavailable — insufficient data to assess."],
      nextReview: "Re-evaluate when a game log and projection are available.",
      fromCanonicalAssessment: false,
    };
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

  const policy = DEFAULT_DECISION_POLICY;
  const isBatter = a.prop.category === "batter";
  const selectedCal = sci.side === "more" ? sci.calibratedProbabilityMore : sci.calibratedProbabilityLess;

  // POSITIVE EVIDENCE — derived from the real facts, only when actually true.
  const positive: string[] = [];
  if (selectedCal !== null && selectedCal >= policy.minimumSelectedSideProbability)
    positive.push(`Calibrated P(${sci.side}) clears the ${sci.policyThresholdPct}% policy threshold`);
  if (sci.modelAdvantagePp !== null && sci.modelAdvantagePp > 0)
    positive.push(`Beats the independent baseline by +${sci.modelAdvantagePp} pp`);
  if (sci.fragilityLevel === "LOW") positive.push("Low fragility under plausible assumptions");
  if (sci.dataQuality >= policy.minimumDataQuality) positive.push(`Data quality ${sci.dataQuality}/100 meets the floor`);
  if (isBatter && opp?.lineupConfirmed) positive.push("Lineup confirmed");
  if (opp?.starterConfirmed) positive.push("Opposing starter confirmed");

  // BLOCKERS / RISKS — the canonical vetoes + reason codes + warnings.
  const blockers = [
    ...assessment.scientificVetoes.map((v) => v.message),
    ...assessment.reasonCodes.filter((c) => c !== "OPPORTUNITY_QUALIFIED").map(labelForCode),
    ...payload.warnings.filter((w) => w.severity !== "info").map((w) => w.message),
  ];

  return {
    status: assessment.status,
    reasons: [...new Set(positive)].slice(0, 6),
    risks: [...new Set(blockers)].slice(0, 6),
    nextReview: nextReviewCondition(assessment.reasonCodes, sci, opp, isBatter),
    fromCanonicalAssessment: true,
  };
}

/** The single most actionable condition that would change the verdict. */
function nextReviewCondition(
  codes: string[],
  sci: VmScientific,
  opp: AnalysisPayload["opponent"],
  isBatter: boolean,
): string {
  if (!sci.calibrationAvailable) return "Re-evaluate when a fitted calibration is available for this market/model version.";
  if (codes.some((c) => c.includes("VALIDAT") || c.includes("MARKET_NOT")) || sci.modelLifecycle === "RESEARCH_ONLY")
    return "Re-evaluate when the market model reaches a BET-eligible lifecycle state.";
  if (isBatter && !opp?.lineupConfirmed) return "Re-evaluate when the lineup is confirmed.";
  if (!opp?.starterConfirmed) return "Re-evaluate when the opposing starter is confirmed.";
  if (sci.fragilityLevel === "HIGH" || sci.fragilityLevel === "EXTREME")
    return "Re-evaluate after more games reduce projection fragility.";
  return "Re-evaluate when a fresh PrizePicks/market line is captured.";
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
  const roof = venueRoof(opp.venueName);
  return {
    venueName: opp.venueName,
    weatherAvailable: false, // no wired weather feed → reported unavailable, not neutral
    roof,
    park: {
      runs: hasFactors ? pf.runs : null,
      hr: hasFactors ? pf.hr : null,
      hits: hasFactors ? pf.hits : null,
    },
    classification: hasFactors ? classification : undefined,
  };
}

// Known fixed/retractable roofs (static; anything else → "unavailable", never assumed open).
const CLOSED_ROOFS = ["tropicana", "rogers centre", "chase field", "minute maid", "globe life", "loandepot", "american family", "t-mobile"];
function venueRoof(venue: string): VmConditions["roof"] {
  const v = venue.toLowerCase();
  return CLOSED_ROOFS.some((r) => v.includes(r)) ? "retractable" : "unavailable";
}

/* ------------------------------- matchup ---------------------------------- */

/**
 * Percentile matchup with REAL percentile ranks from the season Statcast
 * population. For a hitter prop it is batter (player) vs opposing starter; for a
 * pitcher prop it is pitcher (player) vs the opposing-lineup aggregate profile.
 */
export async function buildMatchup(
  payload: AnalysisPayload,
  config: MarketAnalysisConfig,
  season: number,
): Promise<VmMatchup> {
  const isPitcher = config.playerType === "pitcher";
  const playerName = payload.player?.name ?? "Player";
  const oppName = payload.opponent?.opponentTeam ?? (isPitcher ? "Opponent lineup" : "Opposing starter");
  const [batterPop, pitcherPop] = await Promise.all([
    getBatterPopulation(season),
    getPitcherPopulation(season),
  ]);

  let batter: StatcastBatter | null;
  let pitcher: StatcastPitcher | null;
  if (isPitcher) {
    pitcher = payload.statcast.pitcher ?? null;
    batter = await opposingLineupProfile(payload, season); // aggregate lineup
  } else {
    batter = payload.statcast.batter ?? null;
    pitcher = payload.statcast.pitcher ?? null; // opposing starter (already resolved)
  }

  if ((isPitcher && !pitcher) || (!isPitcher && !batter)) {
    return {
      available: false, referenceSize: null, rows: [],
      leftLabel: playerName, rightLabel: oppName,
      note: "Statcast profile unavailable for this player — percentile matchup cannot be built.",
    };
  }

  const { rows, referenceSize } = buildPercentileRows(batter, pitcher, batterPop, pitcherPop, isPitcher ? "pitcher" : "batter");
  const note = referenceSize === null
    ? "Season reference population unavailable — percentile ranks marked N/A (raw values shown)."
    : `Percentiles vs ${referenceSize} qualified players (season Statcast).`;
  return {
    available: rows.length > 0,
    referenceSize,
    rows,
    leftLabel: playerName,
    rightLabel: oppName,
    note,
  };
}

/** PA-weighted Statcast profile of the opposing team's projected lineup. */
async function opposingLineupProfile(payload: AnalysisPayload, season: number): Promise<StatcastBatter | null> {
  const oppTeamId = payload.opponent?.opponentTeamId;
  if (!oppTeamId) return null;
  const lineup = await getProjectedLineup(oppTeamId).catch(() => []);
  if (lineup.length === 0) return null;
  const profiles = await Promise.all(
    lineup.slice(0, 9).map((h) => savantStatcastProvider.getBatter(h.id, season).catch(() => null)),
  );
  const present = profiles.filter((p): p is StatcastBatter => p !== null);
  return aggregateLineupProfile(present);
}

/* --------------------------- opponent context ----------------------------- */

async function buildOpponentContext(payload: AnalysisPayload, config: MarketAnalysisConfig, season: number): Promise<VmOpponentContext> {
  const opp = payload.opponent;
  if (!opp?.opponentTeam) {
    return { kind: "unavailable", lineupStatus: "unavailable", metrics: [], note: "No resolved game — opponent context unavailable." };
  }
  if (config.playerType === "pitcher") {
    // Opposing lineup aggregate profile.
    const profile = await opposingLineupProfile(payload, season);
    const metrics: VmMetric[] = profile
      ? [
          metric("kPct", "Lineup K%", profile.kPct ?? null, "pct"),
          metric("bbPct", "Lineup BB%", profile.bbPct ?? null, "pct"),
          metric("whiffPct", "Lineup Whiff%", profile.whiffPct ?? null, "pct"),
          metric("xwoba", "Lineup xwOBA", profile.xwoba ?? null, "one"),
          metric("hardHitPct", "HardHit%", profile.hardHitPct ?? null, "pct"),
        ]
      : [];
    return {
      kind: "lineup",
      team: opp.opponentTeam,
      lineupStatus: opp.lineupConfirmed ? "confirmed" : "projected",
      metrics,
      note: profile ? undefined : "Opposing-lineup Statcast profile unavailable.",
    };
  }
  // Hitter prop → opposing starter.
  const sp = payload.statcast.pitcher;
  const metrics: VmMetric[] = sp
    ? [
        metric("kPct", "SP K%", sp.kPct ?? null, "pct"),
        metric("bbPct", "SP BB%", sp.bbPct ?? null, "pct"),
        metric("whiffPct", "SP Whiff%", sp.whiffPct ?? null, "pct"),
        metric("xwoba", "xwOBA allowed", sp.xwoba ?? null, "one"),
        metric("hardHitPctAllowed", "HardHit% allowed", sp.hardHitPctAllowed ?? null, "pct"),
      ]
    : [];
  return {
    kind: "starter",
    team: opp.opponentTeam,
    lineupStatus: opp.lineupConfirmed ? "confirmed" : "projected",
    starterName: opp.pitcherName,
    starterHand: opp.pitcherHand,
    starterStatus: opp.starterConfirmed ? "confirmed" : opp.pitcherName ? "projected" : "unavailable",
    metrics,
    note: sp ? undefined : "Opposing-starter Statcast profile unavailable.",
  };
}

/* ------------------------------- splits ----------------------------------- */

const SMALL_SAMPLE_AB = 40;

async function buildSplits(payload: AnalysisPayload, config: MarketAnalysisConfig, season: number): Promise<VmSplit[]> {
  if (!payload.player) return [];
  const group = config.playerType === "pitcher" ? "pitching" : "hitting";
  const splits = await getPlayerSplits(payload.player.id, group, season).catch((): PlayerSplit[] => []);
  // vs LHP/RHP (vl/vr) for hitters == vs LHB/RHB for pitchers.
  const want = config.playerType === "pitcher"
    ? [{ code: "vl", label: "vs LHB" }, { code: "vr", label: "vs RHB" }]
    : [{ code: "vl", label: "vs LHP" }, { code: "vr", label: "vs RHP" }];
  const out: VmSplit[] = [];
  for (const w of want) {
    const s = splits.find((x) => x.code === w.code);
    if (!s) continue;
    const ab = s.atBats ?? null;
    out.push({
      key: w.code,
      label: w.label,
      sampleSize: ab,
      smallSample: ab !== null && ab < SMALL_SAMPLE_AB,
      metrics: [
        metric("avg", "AVG", s.avg ? Number(s.avg) : null, "one"),
        metric("obp", "OBP", s.obp ? Number(s.obp) : null, "one"),
        metric("slg", "SLG", s.slg ? Number(s.slg) : null, "one"),
        metric("ops", "OPS", s.ops ? Number(s.ops) : null, "one"),
      ],
    });
  }
  return out;
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
    edge: pitchEdge(p.whiffPct, p.xwobaAllowed),
  }));
}

/** Pitch-level matchup indicator from whiff% and xwOBA-allowed vs league norms.
    Conservative thresholds; insufficient data → null (N/A). */
function pitchEdge(whiff: number | undefined, xwobaAllowed: number | undefined): VmPitchType["edge"] {
  if (whiff === undefined && xwobaAllowed === undefined) return null;
  let score = 0;
  if (whiff !== undefined) score += whiff >= 30 ? 1 : whiff <= 18 ? -1 : 0;
  if (xwobaAllowed !== undefined) score += xwobaAllowed <= 0.29 ? 1 : xwobaAllowed >= 0.36 ? -1 : 0;
  return score > 0 ? "pitcher" : score < 0 ? "batter" : "neutral";
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
  // Bounded fan-out of the independent enrichment loads.
  const [pitchTypes, matchup, opponent, splits] = await Promise.all([
    buildPitchTypes(payload, config),
    buildMatchup(payload, config, season),
    buildOpponentContext(payload, config, season),
    buildSplits(payload, config, season),
  ]);

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
    opponent,
    matchup,
    splits,
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
    opponentTeamId: o.opponentTeamId,
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
    decision: { status: "UNAVAILABLE", reasons: [], risks: [warning], nextReview: "Re-evaluate when data is available.", fromCanonicalAssessment: false },
    conditions: null,
    opponent: { kind: "unavailable", lineupStatus: "unavailable", metrics: [], note: warning },
    matchup: { available: false, referenceSize: null, rows: [], leftLabel: "Player", rightLabel: "Opponent", note: warning },
    splits: [],
    pitchTypes: [],
    provenance: { dataAsOf: Date.now(), modelVersion: MODEL_VERSION, sources: [], season },
    warnings: [warning],
  };
}
