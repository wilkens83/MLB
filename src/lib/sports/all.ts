/* ============================================================================
   Sport aggregation entry point for the UI.

   The registry (`./registry`) eagerly registers MLB but stays free of tennis
   imports by design, so tennis is only present once its adapter module runs its
   registration side effect. Any UI surface that needs the FULL set of sports
   (the sport switcher, the sidebar, sport-aware routing) imports from here so
   both sports are guaranteed registered in that bundle.

   Importing `@/lib/tennis/adapter` (not the heavy `@/lib/tennis` barrel) keeps
   the client bundle small: the adapter only pulls in the tennis market catalog
   + enums, never the providers / acquisition / model layers.
   ========================================================================== */

import "./registry"; // side effect: register MLB
import "@/lib/tennis/adapter"; // side effect: register Tennis

export type { SportKey, SportMarket, SportAdapter, SportDefinition } from "./types";
export {
  registerSport,
  allSports,
  enabledSports,
  getSport,
  isSport,
} from "./registry";
