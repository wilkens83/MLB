/* ============================================================================
   Provider registry — the single place the app resolves data sources. Swap an
   implementation here (or inject a mock in tests) without touching consumers.
   ========================================================================== */

export { mlbStatsProvider } from "./mlbStats";
export { savantStatcastProvider } from "./statcast";
export { staticParkProvider } from "./park";
export { getAllHealth, getHealth } from "./health";
export type {
  MLBStatsProvider,
  StatcastProvider,
  ParkFactorProvider,
  WeatherProvider,
  ProviderHealth,
} from "./types";
