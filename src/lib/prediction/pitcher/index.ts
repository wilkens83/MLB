/* ============================================================================
   Pitcher usage / joint-simulation — public surface.

   Canonical flow (see CLAUDE.md "Pitcher Joint Simulation"):
     starts → estimatePitcherRates + projectWorkloadBudget
            → runPitcherJointSimulation (usage + removal hazard + events)
            → per-prop distributions (propSimulationFromJoint)
            → market thresholds (P more/less/push) applied last.

   ONE joint simulation per (pitcher, game, data snapshot, model version, seed)
   powers all six props; a market line never changes the underlying simulation.
   ========================================================================== */

export * from "./types";
export { estimatePitcherRates, adjustPitcherRates, normalizeRates, ratesPerBf, battersFacedOf, inningsToOuts, type PitcherStartStat, type RateContext } from "./rates";
export { projectWorkloadBudget, WORKLOAD_PRIORS, type WorkloadBudget } from "./workload";
export { removalHazard, buildRemovalParams, DEFAULT_REMOVAL_PARAMS, REMOVAL_MODEL_VERSION, type RemovalState, type RemovalParams } from "./removal";
export {
  runPitcherJointSimulation, simulatePitcherStart, PITCHER_SIM_ITERATIONS, type LiveState, type PitcherJointInput,
} from "./jointSim";
export { propSimulationFromJoint, jointCorrelation, jointProbBothMore } from "./props";

import { estimatePitcherRates, adjustPitcherRates, type PitcherStartStat, type RateContext } from "./rates";
import { projectWorkloadBudget } from "./workload";
import { runPitcherJointSimulation, type LiveState } from "./jointSim";
import type { PitcherJointSimulation } from "./types";

export interface BuildPitcherJointInput {
  starts: PitcherStartStat[];
  seed: string;
  context?: RateContext;
  live?: LiveState;
  iterations?: number;
}

/**
 * Facade: game log → rates (+context) → workload → joint simulation. This is the
 * single entry point callers should use; it never depends on a market line.
 */
export function buildPitcherJoint(input: BuildPitcherJointInput): PitcherJointSimulation {
  const baseRates = estimatePitcherRates(input.starts);
  const rates = input.context ? adjustPitcherRates(baseRates, input.context) : baseRates;
  const workload = projectWorkloadBudget(input.starts);
  return runPitcherJointSimulation({ rates, workload, seed: input.seed, live: input.live, iterations: input.iterations });
}
