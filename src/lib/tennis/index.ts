/* ============================================================================
   Tennis public surface. Importing this module registers the tennis sport into
   the multi-sport registry (via ./adapter). Nothing in the MLB code path imports
   this, so tennis stays fully isolated until deliberately wired into a route.
   ========================================================================== */

import "./adapter"; // side effect: register tennis sport

export * from "./domain";
export * from "./providers";
export * from "./data";
export { TENNIS_MARKETS, getTennisMarket } from "./domain/markets";
