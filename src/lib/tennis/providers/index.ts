/* ============================================================================
   Public surface of the tennis provider layer.
   ========================================================================== */

export type {
  TennisDataProvider, TennisProviderHealth, ProviderCapabilities, ProviderStatus,
  CapabilityStatus, ProviderProvenance, RateLimitState, ScheduleQuery, HistoricalQuery,
} from "./types";
export { ROUTABLE_STATUSES } from "./types";
export { fixtureProvider } from "./fixtureProvider";
export { sportradarProvider, sportsDataIoProvider, apiTennisProvider } from "./liveProviders";
export { createCredentialedProvider } from "./credentialedProvider";
export { createHistoricalCsvProvider, parseHistoricalCsv, isDangerousCell } from "./historicalCsv";
export { createManualProvider } from "./manualProvider";
export { TennisProviderRegistry, type SelectionReason } from "./registry";
export {
  getAllTennisHealth, getTennisHealth, setStatus, recordSuccess, recordFailure,
  recordVerified, recordRateLimit, hasVerified, __resetHealth,
} from "./health";
export {
  httpGetJson, sanitizeUrl, sanitizeHeaders, makeProvenance, type HttpResult, type HttpError,
} from "./http";
export {
  verifyMatches, verifyRankings, partitionMatches, matchesAcceptable, rankingsAcceptable,
  type VerifyReport, type VerifyIssue, type Verdict,
} from "./verify";
export type { LiveAdapter } from "./adapters/shared";
export { apiTennisAdapter } from "./adapters/apiTennis";
export { sportradarAdapter } from "./adapters/sportradar";
export { sportsDataIoAdapter } from "./adapters/sportsdataio";
