/* ============================================================================
   Tennis sport adapter + self-registration into the multi-sport registry.

   Importing this module registers tennis. It is intentionally NOT imported by
   any MLB code path — the tennis surface is reached only through code that opts
   into tennis, and the registration is gated by `enabled` so the UI can hide
   tennis until its acquisition + simulation layers are verified (audit §8).
   ========================================================================== */

import { registerSport } from "@/lib/sports/registry";
import type { SportAdapter, SportMarket } from "@/lib/sports/types";
import { TENNIS_MARKETS, getTennisMarket } from "./domain/markets";

export const tennisAdapter: SportAdapter = {
  key: "tennis",
  markets(): SportMarket[] {
    return TENNIS_MARKETS;
  },
  getMarket(key: string): SportMarket | undefined {
    return getTennisMarket(key);
  },
};

registerSport({
  key: "tennis",
  label: "Tennis",
  tagline: "ATP/WTA match & player-prop analytics — structural simulation + EV",
  basePath: "/tennis",
  icon: "Circle",
  // Acquisition (Phases 4–5), structural simulation (Phase 6) and the market
  // engine (Phases 7–10) are verified, so tennis is now surfaced in the UI. The
  // `/tennis/*` routes render the real engine's outputs where data exists and
  // honest empty/degraded states where a live provider is not configured.
  enabled: true,
  adapter: tennisAdapter,
});
