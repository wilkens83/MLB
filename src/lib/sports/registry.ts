/* ============================================================================
   Sport registry — the single place the platform resolves "which sports exist"
   and their adapters. Consumers ask the registry, never import a sport directly,
   so adding a sport is one registration + its own namespace.

   Tennis is registered by `src/lib/tennis/*` (Phase 3+) via `registerSport` so
   this module stays free of tennis imports and MLB is unaffected if the tennis
   namespace is absent. MLB is registered eagerly below because it is the
   platform's founding sport and always present.
   ========================================================================== */

import type { SportDefinition, SportKey } from "./types";
import { mlbAdapter } from "./mlbAdapter";

const REGISTRY = new Map<SportKey, SportDefinition>();

/** Register (or replace) a sport. Idempotent by key. */
export function registerSport(def: SportDefinition): void {
  REGISTRY.set(def.key, def);
}

/** All registered sports, in registration order. */
export function allSports(): SportDefinition[] {
  return [...REGISTRY.values()];
}

/** Only sports currently exposed in the UI (see SportDefinition.enabled). */
export function enabledSports(): SportDefinition[] {
  return allSports().filter((s) => s.enabled);
}

export function getSport(key: SportKey): SportDefinition | undefined {
  return REGISTRY.get(key);
}

export function isSport(key: string): key is SportKey {
  return REGISTRY.has(key as SportKey);
}

// ---- MLB: the founding sport, always registered. ---------------------------
registerSport({
  key: "mlb",
  label: "MLB",
  tagline: "Player-props analytics — projection + Monte Carlo + EV",
  basePath: "/",
  icon: "Diamond",
  enabled: true,
  adapter: mlbAdapter,
});
