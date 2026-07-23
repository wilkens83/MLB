/* ============================================================================
   Multi-sport core — the abstraction that turns Diamond Edge from an MLB app into
   a platform hosting many sports through shared adapters.

   The design goal (Phase 1 of the tennis integration) is ADDITIVE: introducing a
   `SportKey` and a registry must not change any MLB behavior. MLB is registered
   here descriptively — the registry points at the existing engine, it does not
   rewrite it. The pure analytics core (math, odds, simulate, hitRate) is already
   sport-neutral; this module names the sports and the contract each one fulfills.
   ========================================================================== */

import type { DistFamily } from "@/lib/props/catalog";

/** The set of sports the platform can host. Extend the union to add a sport. */
export type SportKey = "mlb" | "tennis";

/**
 * A market a sport exposes, declared in that sport's own catalog. The
 * `distFamily` reuses the shared distribution families the simulation engine
 * already understands, so a market can be simulated without sport-specific code
 * in `simulate.ts`. `structural` flags markets that are produced by a structural
 * Monte Carlo (e.g. tennis point→game→set→match) and summarized via
 * `summarizeSamples`, rather than drawn from a closed-form family.
 */
export interface SportMarket {
  key: string;
  label: string;
  shortLabel: string;
  /** Grouping used by the UI (e.g. MLB "batter"/"pitcher"; tennis "match"/"player"). */
  group: string;
  distFamily: DistFamily;
  defaultLine: number;
  step: number;
  unit: string;
  /** True when the market is produced by a structural simulator + summarizeSamples. */
  structural?: boolean;
  description: string;
}

/**
 * The contract every sport fulfills. It is intentionally small: the shared
 * engine (projection → simulate → recommend) does the heavy lifting, so a sport
 * only needs to describe its identity, its markets, and how to look up a market.
 * Heavier per-sport behavior (data acquisition, structural simulation) lives in
 * that sport's own namespace and is referenced from `SportDefinition`, not forced
 * into this interface.
 */
export interface SportAdapter {
  readonly key: SportKey;
  /** All markets this sport supports. */
  markets(): SportMarket[];
  /** Look up a single market by key; undefined if unknown. */
  getMarket(key: string): SportMarket | undefined;
}

/** Registry-facing description of a sport: identity + adapter + availability. */
export interface SportDefinition {
  key: SportKey;
  /** Display name, e.g. "MLB", "Tennis". */
  label: string;
  /** One-line description for nav / landing surfaces. */
  tagline: string;
  /** URL segment this sport lives under (MLB currently at root; tennis at /tennis). */
  basePath: string;
  /** Lucide icon name used by the shell (kept as a string to avoid importing the icon here). */
  icon: string;
  /**
   * Whether the sport is exposed in the UI. Tennis ships behind this flag until
   * its acquisition + simulation layers are verified, so the surface can be
   * hidden without reverting code (audit §8 rollback strategy).
   */
  enabled: boolean;
  /** The behavioral contract. */
  adapter: SportAdapter;
}
