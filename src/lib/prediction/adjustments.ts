/* ============================================================================
   Adjustment engine (explainable predictions). Starting from a player's own
   shrunk expectation (the "base"), it applies transparent, itemized context
   multipliers — park, weather, opposing pitcher (from real Statcast),
   handedness platoon, and recent form — and returns an AdjustmentBreakdown
   whose additive deltas reconcile base → final in the prop's own units.

   Every multiplier is deliberately conservative and clamped so no single
   factor dominates and small samples cannot produce false precision.
   ========================================================================== */

import { clamp, round } from "@/lib/utils";
import { parkMultiplierForProp, weatherMultiplier } from "@/lib/mlb/context";
import type { AdjustmentBreakdown, AdjustmentFactor, Handedness, StatcastPitcher } from "@/lib/domain/models";

// League baselines used as neutral reference points.
const LEAGUE_XWOBA = 0.315;
const LEAGUE_PITCHER_K_PCT = 22.0;
const LEAGUE_PITCHER_BB_PCT = 8.0;

const OFFENSE_PROPS = new Set([
  "hits", "home_runs", "runs", "rbis", "total_bases", "hits_runs_rbis",
  "singles", "doubles", "triples", "walks", "fantasy_points",
]);

export interface AdjustmentInputs {
  propKey: string;
  base: number;
  venueName?: string;
  tempF?: number;
  batterHand?: Handedness;
  /** Opposing pitcher for batter props (from Statcast provider). */
  opposingPitcher?: StatcastPitcher | null;
  opposingPitcherHand?: Handedness;
  /** Recent form ratio (recent EWMA / season mean); ~1 = neutral. */
  formRatio?: number;
}

function factor(
  key: string,
  label: string,
  running: number,
  multiplier: number,
): { factor: AdjustmentFactor; next: number } {
  const m = Number.isFinite(multiplier) ? multiplier : 1;
  const next = running * m;
  const delta = next - running;
  return {
    factor: {
      key,
      label,
      delta: round(delta, 3),
      multiplier: round(m, 3),
      direction: m > 1.001 ? "up" : m < 0.999 ? "down" : "neutral",
    },
    next,
  };
}

/** Opposing-pitcher offense suppression from xwOBA-against, dampened + clamped. */
function pitcherOffenseMultiplier(p: StatcastPitcher): number | null {
  if (p.xwoba === undefined) return null;
  const ratio = p.xwoba / LEAGUE_XWOBA; // <1 = suppresses offense
  return clamp(1 + (ratio - 1) * 0.6, 0.82, 1.18);
}

/**
 * Offense multiplier for the plate-appearance simulator's hit outcomes, given
 * the opposing pitcher. K-rate and BB-rate props are handled by their own
 * per-outcome multipliers, so they get a neutral offense scale.
 */
export function pitcherOffenseMultiplierForProp(
  propKey: string,
  pitcher: StatcastPitcher | null,
): number {
  if (!pitcher || propKey === "batter_strikeouts" || propKey === "walks") return 1;
  const m = pitcherOffenseMultiplier(pitcher);
  return m ?? 1;
}

/** Platoon multiplier: batters do better vs opposite-handed pitchers. */
function platoonMultiplier(batter?: Handedness, pitcher?: Handedness): number {
  if (!batter || !pitcher || batter === "unknown" || pitcher === "unknown") return 1;
  if (batter === "S") return 1; // switch hitters neutralize platoon
  return batter !== pitcher ? 1.05 : 0.96;
}

export function buildAdjustmentBreakdown(input: AdjustmentInputs): AdjustmentBreakdown {
  const { propKey, base } = input;
  const factors: AdjustmentFactor[] = [];
  let running = base;

  // Park
  const parkM = parkMultiplierForProp(propKey, input.venueName);
  if (parkM !== 1) {
    const r = factor("park", "Ballpark", running, parkM);
    factors.push(r.factor);
    running = r.next;
  }

  // Weather (temperature)
  const weatherM = weatherMultiplier(propKey, input.tempF);
  if (weatherM !== 1) {
    const r = factor("weather", "Weather / temp", running, weatherM);
    factors.push(r.factor);
    running = r.next;
  }

  // Opposing pitcher (batter props only)
  if (input.opposingPitcher) {
    let oppM: number | null = null;
    let label = "Opposing pitcher";
    if (propKey === "batter_strikeouts" && input.opposingPitcher.kPct !== undefined) {
      oppM = clamp((input.opposingPitcher.kPct / LEAGUE_PITCHER_K_PCT) ** 0.7, 0.75, 1.35);
      label = "Opp. pitcher K%";
    } else if (propKey === "walks" && input.opposingPitcher.bbPct !== undefined) {
      oppM = clamp((input.opposingPitcher.bbPct / LEAGUE_PITCHER_BB_PCT) ** 0.6, 0.75, 1.35);
      label = "Opp. pitcher BB%";
    } else if (OFFENSE_PROPS.has(propKey)) {
      oppM = pitcherOffenseMultiplier(input.opposingPitcher);
      label = "Opp. pitcher (xwOBA)";
    }
    if (oppM !== null) {
      const r = factor("opponent", label, running, oppM);
      factors.push(r.factor);
      running = r.next;
    }
  }

  // Handedness platoon (offense props only)
  if (OFFENSE_PROPS.has(propKey)) {
    const platoonM = platoonMultiplier(input.batterHand, input.opposingPitcherHand);
    if (platoonM !== 1) {
      const r = factor("handedness", "Handedness", running, platoonM);
      factors.push(r.factor);
      running = r.next;
    }
  }

  // Recent form (dampened, since the base already carries EWMA recency).
  if (input.formRatio !== undefined && Number.isFinite(input.formRatio)) {
    const formM = clamp(1 + (input.formRatio - 1) * 0.3, 0.88, 1.14);
    if (Math.abs(formM - 1) > 0.005) {
      const r = factor("recency", "Recent form", running, formM);
      factors.push(r.factor);
      running = r.next;
    }
  }

  return { base: round(base, 3), factors, final: round(Math.max(0, running), 3) };
}
