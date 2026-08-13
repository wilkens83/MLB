/* ============================================================================
   Workload budget — the INPUT to the start simulator: how many pitches the
   manager is planning around and how many pitches this pitcher throws per batter.
   Derived from recent starts (recency-weighted), with explicit versioned priors
   when the game log lacks pitch counts. Provenance records exactly what was used.
   ========================================================================== */

import { clamp } from "@/lib/utils";
import { battersFacedOf, type PitcherStartStat } from "./rates";
import type { ProvenanceSource, UsageProvenance } from "./types";
import { PITCHER_SIM_VERSION } from "./types";

/** Explicit, versioned fallback priors (used only when data is missing). */
export const WORKLOAD_PRIORS = {
  pitchesPerBf: 3.9, // league-ish starter pitches per batter faced
  targetPitches: 88, // typical modern starter budget
  avgBattersFaced: 23,
};

export interface WorkloadBudget {
  /** Pitch budget the manager plans around (drives the removal soft/hard caps). */
  targetPitches: number;
  /** Pitches thrown per batter faced (converts BF ↔ pitches during the sim). */
  pitchesPerBf: number;
  /** Recent average batters faced (a soft target, not a hard exposure). */
  avgBattersFaced: number;
  provenance: UsageProvenance;
}

/** Recency weight for the i-th of n starts (oldest→newest): newest weight 1. */
function recencyWeight(i: number, n: number): number {
  return Math.pow(0.85, n - 1 - i);
}

export function projectWorkloadBudget(starts: PitcherStartStat[]): WorkloadBudget {
  const n = starts.length;
  const warnings: string[] = [];
  const sources: Record<string, ProvenanceSource> = {};

  let wPitches = 0;
  let wBf = 0;
  let pitchStarts = 0;
  let bfStarts = 0;
  let wPitchesPerBf = 0;
  let wPerBfDen = 0;

  starts.forEach((s, i) => {
    const w = recencyWeight(i, n);
    const bf = battersFacedOf(s);
    if (bf > 0) { wBf += w * bf; bfStarts++; }
    if (s.numberOfPitches && s.numberOfPitches > 0) {
      wPitches += w * s.numberOfPitches;
      pitchStarts++;
      if (bf > 0) { wPitchesPerBf += w * (s.numberOfPitches / bf); wPerBfDen += w; }
    }
  });

  const hadPitchCounts = pitchStarts > 0;
  const hadBattersFaced = bfStarts > 0;

  const avgBattersFaced = hadBattersFaced ? wBf / (starts.reduce((a, s, i) => a + (battersFacedOf(s) > 0 ? recencyWeight(i, n) : 0), 0)) : WORKLOAD_PRIORS.avgBattersFaced;
  sources.avgBattersFaced = hadBattersFaced ? "gamelog" : "prior";
  if (!hadBattersFaced) warnings.push("no batters-faced data — using league prior");

  const pitchesPerBf = wPerBfDen > 0 ? clamp(wPitchesPerBf / wPerBfDen, 3.0, 4.6) : WORKLOAD_PRIORS.pitchesPerBf;
  sources.pitchesPerBf = wPerBfDen > 0 ? "gamelog" : "prior";

  let targetPitches: number;
  if (hadPitchCounts) {
    const meanPitches = wPitches / (starts.reduce((a, s, i) => a + ((s.numberOfPitches ?? 0) > 0 ? recencyWeight(i, n) : 0), 0));
    targetPitches = clamp(meanPitches, 55, 110);
    sources.targetPitches = "gamelog";
  } else if (hadBattersFaced) {
    targetPitches = clamp(avgBattersFaced * pitchesPerBf, 55, 110);
    sources.targetPitches = "blend";
    warnings.push("no pitch counts — target pitches derived from BF × prior pitches/BF");
  } else {
    targetPitches = WORKLOAD_PRIORS.targetPitches;
    sources.targetPitches = "prior";
    warnings.push("no workload history — using league prior budget");
  }

  return {
    targetPitches: Math.round(targetPitches),
    pitchesPerBf,
    avgBattersFaced,
    provenance: {
      version: PITCHER_SIM_VERSION,
      startsUsed: n,
      hadPitchCounts,
      hadBattersFaced,
      sources,
      warnings,
      generatedAt: Date.now(),
    },
  };
}
