/* ============================================================================
   MLB sport adapter — registers the EXISTING MLB engine into the multi-sport
   registry without changing it. This file only *describes* the already-shipped
   prop catalog through the shared `SportMarket` shape; it does not touch the
   projection/simulation/analysis code. MLB behavior is therefore byte-for-byte
   unchanged by the introduction of the sport registry.
   ========================================================================== */

import { PROP_CATALOG, getProp } from "@/lib/props/catalog";
import type { SportAdapter, SportMarket } from "./types";

function toMarket(key: string): SportMarket | undefined {
  const p = getProp(key);
  if (!p) return undefined;
  return {
    key: p.key,
    label: p.label,
    shortLabel: p.shortLabel,
    group: p.category,
    distFamily: p.family,
    defaultLine: p.defaultLine,
    step: p.step,
    unit: p.unit,
    description: p.description,
  };
}

export const mlbAdapter: SportAdapter = {
  key: "mlb",
  markets(): SportMarket[] {
    return PROP_CATALOG.map((p) => toMarket(p.key)!).filter(Boolean);
  },
  getMarket(key: string): SportMarket | undefined {
    return toMarket(key);
  },
};
