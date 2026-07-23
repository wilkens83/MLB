/* ============================================================================
   Public surface of the multi-sport core. Import from here.
   ========================================================================== */

export type { SportKey, SportMarket, SportAdapter, SportDefinition } from "./types";
export {
  registerSport,
  allSports,
  enabledSports,
  getSport,
  isSport,
} from "./registry";
