/* ============================================================================
   Data-quality scoring and prediction warnings (2K). A prediction is only as
   trustworthy as its inputs — we score sample size + source availability and
   attach explicit warnings so the UI never implies false precision.
   ========================================================================== */

import { clamp, round } from "@/lib/utils";
import type { DataQuality, PredictionWarning } from "@/lib/domain/models";

export interface QualityInputs {
  sampleSize: number;
  hasStatcast: boolean;
  hasOpponent: boolean;
  hasWeather: boolean;
  hasLineup: boolean;
}

export function scoreDataQuality(q: QualityInputs): DataQuality {
  // Sample contributes up to 60 pts (saturating ~25 games), sources up to 40.
  const sampleComponent = 60 * (1 - Math.exp(-q.sampleSize / 12));
  const sourceComponent =
    (q.hasStatcast ? 20 : 0) + (q.hasOpponent ? 12 : 0) + (q.hasWeather ? 4 : 0) + (q.hasLineup ? 4 : 0);
  const score = clamp(round(sampleComponent + sourceComponent, 0), 0, 100);
  const tier = score >= 70 ? "high" : score >= 45 ? "medium" : "low";
  return {
    score,
    sampleSize: q.sampleSize,
    hasStatcast: q.hasStatcast,
    hasOpponent: q.hasOpponent,
    hasWeather: q.hasWeather,
    hasLineup: q.hasLineup,
    tier,
  };
}

export interface WarningInputs {
  sampleSize: number;
  hasStatcast: boolean;
  hasOpponent: boolean;
  hasWeather: boolean;
  lineupConfirmed: boolean;
  starterConfirmed: boolean;
  manualOdds: boolean;
  /** |modelProb - marketImplied| when a price is present. */
  modelDisagreement?: number;
  dataAgeMs?: number;
}

export function buildWarnings(w: WarningInputs): PredictionWarning[] {
  const out: PredictionWarning[] = [];
  if (w.sampleSize < 5)
    out.push({ code: "small_sample", severity: "high", message: `Only ${w.sampleSize} games — projection heavily regressed to prior.` });
  else if (w.sampleSize < 12)
    out.push({ code: "small_sample", severity: "warn", message: `Modest sample (${w.sampleSize} games).` });
  if (!w.hasStatcast)
    out.push({ code: "missing_statcast", severity: "info", message: "No season Statcast row for this player." });
  if (!w.hasOpponent)
    out.push({ code: "uncertain_starter", severity: "info", message: "Opposing starter unknown or no Statcast — opponent adjustment neutral." });
  if (!w.lineupConfirmed)
    out.push({ code: "unconfirmed_lineup", severity: "info", message: "Lineup not confirmed; batting order/PA estimate is projected." });
  if (!w.hasWeather)
    out.push({ code: "missing_weather", severity: "info", message: "No weather data; temperature adjustment neutral." });
  if (w.manualOdds)
    out.push({ code: "manual_odds", severity: "info", message: "Odds were entered manually (no live price feed)." });
  if (w.modelDisagreement !== undefined && w.modelDisagreement > 0.18)
    out.push({ code: "model_disagreement", severity: "warn", message: `Model differs from the market by ${(w.modelDisagreement * 100).toFixed(0)} pts.` });
  if (w.dataAgeMs !== undefined && w.dataAgeMs > 24 * 3600 * 1000)
    out.push({ code: "stale_data", severity: "warn", message: "Underlying data is over a day old." });
  return out;
}
