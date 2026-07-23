/* ============================================================================
   Public surface of the tennis provider layer.
   ========================================================================== */

export type {
  TennisDataProvider, TennisProviderHealth, ProviderCapabilities, ProviderStatus,
  ScheduleQuery, HistoricalQuery,
} from "./types";
export { fixtureProvider } from "./fixtureProvider";
export { sportradarProvider, sportsDataIoProvider, apiTennisProvider } from "./liveProviders";
export { createHistoricalCsvProvider, parseHistoricalCsv, isDangerousCell } from "./historicalCsv";
export { createManualProvider } from "./manualProvider";
export { TennisProviderRegistry } from "./registry";
export {
  getAllTennisHealth, getTennisHealth, setStatus, recordSuccess, recordFailure, __resetHealth,
} from "./health";
