/* ============================================================================
   Fragility & sensitivity analysis. Measures whether a projection stays stable
   under plausible changes to the assumptions that actually matter. Extends the
   decision-layer sensitivity sweep (reused, not replaced) with:
     - hitter/pitcher-specific, named perturbation scenarios (weather is NEVER
       invented — a weather scenario is only included when weather is available);
     - a pure, CONFIGURABLE summarizer (thresholds are inputs, not hard-coded
       scientific truth): probabilityRange, medianScenarioProbability,
       directionFlipCount, fragilityScore, and fragilityLevel;
     - the critical rule: when plausible scenarios repeatedly cross 50% or reverse
       the preferred side, the projection is DIRECTION-UNSTABLE and must not
       qualify as an opportunity.
   ========================================================================== */

import { simulateHitterGame, simulatePitcherGame, unitRng, type HitterGameOutcome, type PitcherGameOutcome } from "@/lib/prizepicks/entry/jointSim";
import { scaleRates } from "@/lib/prizepicks/decision/sensitivity";
import type { PaRates } from "@/lib/prediction/paSim";
import { clamp } from "@/lib/utils";

export type FragilityLevel = "LOW" | "MODERATE" | "HIGH" | "EXTREME";

export interface ScenarioProbability {
  label: string;
  /** The assumption axis this scenario perturbs (for provenance/UI). */
  assumption: string;
  probability: number;
}

export interface FragilitySummary {
  baseProbability: number;
  scenarioProbabilities: ScenarioProbability[];
  probabilityRange: number;
  medianScenarioProbability: number;
  /** How many scenarios land on the OPPOSITE side of 50% from the base. */
  directionFlipCount: number;
  fragilityScore: number; // 0..100
  fragilityLevel: FragilityLevel;
  /** True when the preferred side is not robust — do not qualify (critical rule). */
  directionUnstable: boolean;
  mostInfluentialAssumption?: string;
}

/**
 * Interpretation config — EMPIRICALLY CONFIGURABLE, not asserted as truth. The
 * thresholds map a fragility score to a level and decide direction-instability.
 */
export interface FragilityConfig {
  /** fragilityScore ≥ these → the corresponding level. */
  moderateAt: number;
  highAt: number;
  extremeAt: number;
  /** A swing of this much win-probability maps to fragility 100. */
  rangeToFullFragility: number;
  /** Fragility added per direction flip. */
  flipPenalty: number;
  /** ≥ this many direction flips ⇒ directionUnstable (do not qualify). */
  maxDirectionFlips: number;
}

export const DEFAULT_FRAGILITY_CONFIG: FragilityConfig = {
  moderateAt: 25,
  highAt: 50,
  extremeAt: 75,
  rangeToFullFragility: 0.2,
  flipPenalty: 12,
  maxDirectionFlips: 2,
};

function median(xs: number[]): number {
  if (xs.length === 0) return 0;
  const s = [...xs].sort((a, b) => a - b);
  const mid = Math.floor(s.length / 2);
  return s.length % 2 ? s[mid] : (s[mid - 1] + s[mid]) / 2;
}
const round = (x: number) => Math.round(x * 1000) / 1000;

function levelFor(score: number, cfg: FragilityConfig): FragilityLevel {
  if (score >= cfg.extremeAt) return "EXTREME";
  if (score >= cfg.highAt) return "HIGH";
  if (score >= cfg.moderateAt) return "MODERATE";
  return "LOW";
}

/**
 * Pure summarizer: given the base probability and scenario probabilities, compute
 * the fragility outputs. Deterministic; the same inputs always give the same
 * result. Direction flips (a scenario crossing to the other side of 50%) both
 * count toward `directionFlipCount` and raise the fragility score.
 */
export function summarizeFragility(
  baseProbability: number,
  scenarios: ScenarioProbability[],
  cfg: FragilityConfig = DEFAULT_FRAGILITY_CONFIG,
): FragilitySummary {
  const probs = scenarios.map((s) => s.probability);
  const all = [baseProbability, ...probs];
  const range = Math.max(...all) - Math.min(...all);
  const baseMore = baseProbability >= 0.5;
  const directionFlipCount = probs.filter((p) => (p >= 0.5) !== baseMore).length;

  const rangeFragility = clamp(Math.round((range / cfg.rangeToFullFragility) * 100), 0, 100);
  const fragilityScore = clamp(Math.round(rangeFragility + directionFlipCount * cfg.flipPenalty), 0, 100);
  const fragilityLevel = levelFor(fragilityScore, cfg);

  const mostInfluential = scenarios.reduce<ScenarioProbability | undefined>(
    (a, b) => (a === undefined || Math.abs(b.probability - baseProbability) > Math.abs(a.probability - baseProbability) ? b : a),
    undefined,
  );

  return {
    baseProbability: round(baseProbability),
    scenarioProbabilities: scenarios.map((s) => ({ ...s, probability: round(s.probability) })),
    probabilityRange: round(range),
    medianScenarioProbability: round(median(probs)),
    directionFlipCount,
    fragilityScore,
    fragilityLevel,
    directionUnstable: directionFlipCount >= cfg.maxDirectionFlips || fragilityLevel === "EXTREME",
    mostInfluentialAssumption: mostInfluential?.assumption,
  };
}

/* --------------------------- sim-backed analysis -------------------------- */

const HITTER_FIELD: Record<string, keyof HitterGameOutcome> = {
  hits: "hits", total_bases: "total_bases", home_runs: "home_runs", singles: "singles",
  doubles: "doubles", triples: "triples", walks: "walks", batter_strikeouts: "batter_strikeouts",
};
const PITCHER_FIELD: Record<string, keyof PitcherGameOutcome> = {
  strikeouts: "strikeouts", pitcher_outs: "pitcher_outs", hits_allowed: "hits_allowed",
  pitcher_walks: "pitcher_walks", home_runs_allowed: "home_runs_allowed", earned_runs: "earned_runs",
};

/** A named, plausible perturbation of one assumption. */
export interface Perturbation {
  label: string;
  assumption: string;
  offenseMult?: number; // matchup / park / opposing-pitcher / recent form
  kMult?: number; // K-profile / removal-related strikeout shift
  expectedDelta?: number; // ± PA/BF (opportunity volume)
  expectedMult?: number; // proportional PA/BF change (e.g. start probability)
}

export interface FragilityAnalysisInput {
  kind: "hitter" | "pitcher";
  market: string;
  line: number;
  direction: "more" | "less";
  rates: PaRates;
  expected: number;
  iterations?: number;
  seed?: string;
  /** Weather is only perturbed when actually available — never invented. */
  weatherAvailable?: boolean;
  config?: FragilityConfig;
}

/** Hitter perturbations: expected PA, lineup slot, start probability, opposing
    pitcher, park factor, recent-form weighting (+ weather only if available). */
export function hitterPerturbations(weatherAvailable = false): Perturbation[] {
  const base: Perturbation[] = [
    { label: "−1 expected PA", assumption: "expected_pa", expectedDelta: -1 },
    { label: "+1 expected PA", assumption: "expected_pa", expectedDelta: +1 },
    { label: "lineup slot down (−0.6 PA)", assumption: "lineup_slot", expectedDelta: -0.6 },
    { label: "may not start (−15% PA)", assumption: "start_probability", expectedMult: 0.85 },
    { label: "tougher opposing pitcher (−10% offense)", assumption: "opposing_pitcher", offenseMult: 0.9 },
    { label: "easier opposing pitcher (+10% offense)", assumption: "opposing_pitcher", offenseMult: 1.1 },
    { label: "park suppresses (−5% offense)", assumption: "park_factor", offenseMult: 0.95 },
    { label: "recent form fades (−8% offense)", assumption: "recent_form", offenseMult: 0.92 },
  ];
  if (weatherAvailable) base.push({ label: "wind in (−7% offense)", assumption: "weather", offenseMult: 0.93 });
  return base;
}

/** Pitcher perturbations: expected BF, pitch count, removal hazard, opponent K
    profile, recent workload, manager hook (+ weather only if available). */
export function pitcherPerturbations(weatherAvailable = false): Perturbation[] {
  const base: Perturbation[] = [
    { label: "−2 expected BF", assumption: "expected_bf", expectedDelta: -2 },
    { label: "+2 expected BF", assumption: "expected_bf", expectedDelta: +2 },
    { label: "low pitch-count cap (−3 BF)", assumption: "pitch_count", expectedDelta: -3 },
    { label: "early removal hazard (−4 BF)", assumption: "removal_hazard", expectedDelta: -4 },
    { label: "quick manager hook (−3 BF)", assumption: "manager_hook", expectedDelta: -3 },
    { label: "high-K opponent (+10% K)", assumption: "opponent_k_profile", kMult: 1.1 },
    { label: "low-K opponent (−10% K)", assumption: "opponent_k_profile", kMult: 0.9 },
    { label: "heavy recent workload (−2 BF)", assumption: "recent_workload", expectedDelta: -2 },
  ];
  if (weatherAvailable) base.push({ label: "cold suppresses offense (−5% offense)", assumption: "weather", offenseMult: 0.95 });
  return base;
}

function probFor(input: FragilityAnalysisInput, rates: PaRates, expected: number): number {
  const iters = input.iterations ?? 4000;
  // Deterministic seed keyed by the perturbed assumptions → reproducible.
  const rng = unitRng(`${input.seed ?? "frag"}:${expected.toFixed(3)}:${JSON.stringify(rates).length}`);
  let win = 0;
  for (let i = 0; i < iters; i++) {
    const value = input.kind === "hitter"
      ? simulateHitterGame(rates, expected, rng)[HITTER_FIELD[input.market]]
      : simulatePitcherGame(rates, expected, rng)[PITCHER_FIELD[input.market]];
    const w = input.direction === "more" ? value > input.line : value < input.line;
    if (w) win++;
  }
  return win / iters;
}

function applyPerturbation(input: FragilityAnalysisInput, p: Perturbation): { rates: PaRates; expected: number } {
  const rates = (p.offenseMult !== undefined || p.kMult !== undefined)
    ? scaleRates(input.rates, p.offenseMult ?? 1, p.kMult ?? 1)
    : input.rates;
  let expected = input.expected;
  if (p.expectedMult !== undefined) expected *= p.expectedMult;
  if (p.expectedDelta !== undefined) expected += p.expectedDelta;
  return { rates, expected: Math.max(1, expected) };
}

/** Run the full, sim-backed fragility analysis over the configured perturbations. */
export function runFragilityAnalysis(input: FragilityAnalysisInput): FragilitySummary {
  const cfg = input.config ?? DEFAULT_FRAGILITY_CONFIG;
  const base = probFor(input, input.rates, input.expected);
  const perturbations = input.kind === "hitter"
    ? hitterPerturbations(input.weatherAvailable)
    : pitcherPerturbations(input.weatherAvailable);
  const scenarios: ScenarioProbability[] = perturbations.map((p) => {
    const { rates, expected } = applyPerturbation(input, p);
    return { label: p.label, assumption: p.assumption, probability: probFor(input, rates, expected) };
  });
  return summarizeFragility(base, scenarios, cfg);
}
