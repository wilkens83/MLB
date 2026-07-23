/* ============================================================================
   Model provenance. Every prediction and simulation stores a TennisModelVersion
   so a result is reproducible from a pinned code + config state, NOT merely from
   "latest". The config checksum ties the numbers back to the exact weights used.
   ========================================================================== */

import { seedFromString } from "@/lib/math/stats";
import type { TennisModelConfig } from "./config";

export const FEATURE_VERSION = "tennis-features-1.0.0";
export const RATING_VERSION = "tennis-elo-1.0.0";
export const SIMULATOR_VERSION = "tennis-sim-1.0.0";
export const MARKET_VERSION = "tennis-markets-1.0.0";
export const MODEL_VERSION = "tennis-model-1.0.0";

export interface TennisModelVersion {
  model: string;
  feature: string;
  simulator: string;
  rating: string;
  scoringRulesVersion: string;
  configChecksum: string;
}

/** Recursively serialize with keys sorted at every level (stable across runs). */
function canonicalize(value: unknown): string {
  if (value === null || typeof value !== "object") return JSON.stringify(value);
  if (Array.isArray(value)) return `[${value.map(canonicalize).join(",")}]`;
  const obj = value as Record<string, unknown>;
  const keys = Object.keys(obj).sort();
  return `{${keys.map((k) => `${JSON.stringify(k)}:${canonicalize(obj[k])}`).join(",")}}`;
}

/** Stable checksum of a config object (canonical JSON → 32-bit hex). */
export function configChecksum(config: TennisModelConfig): string {
  return seedFromString(canonicalize(config)).toString(16).padStart(8, "0");
}

/** Short descriptor of the scoring rules, for provenance. */
export function scoringRulesVersion(config: TennisModelConfig): string {
  const s = config.scoring;
  return `bo${s.bestOf}-tb${s.tiebreakAt}@${s.tiebreakPoints}-fst${s.finalSetTiebreak ? s.finalSetTiebreakPoints : "adv"}`;
}

export function buildModelVersion(config: TennisModelConfig): TennisModelVersion {
  return {
    model: MODEL_VERSION,
    feature: FEATURE_VERSION,
    simulator: SIMULATOR_VERSION,
    rating: RATING_VERSION,
    scoringRulesVersion: scoringRulesVersion(config),
    configChecksum: configChecksum(config),
  };
}
