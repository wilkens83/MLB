/* ============================================================================
   Named live-provider instances. Each wraps a provider-specific `LiveAdapter`
   (real documented endpoints, auth, schemas, and canonical mapping) in the shared
   credentialed factory. They are INERT without their API key env var and only
   reach "ready" after a verified live call (see credentialedProvider.ts).
   Endpoints/licensing are documented in docs/tennis/PROVIDERS.md.
   ========================================================================== */

import { createCredentialedProvider } from "./credentialedProvider";
import { sportradarAdapter } from "./adapters/sportradar";
import { sportsDataIoAdapter } from "./adapters/sportsdataio";
import { apiTennisAdapter } from "./adapters/apiTennis";

/** Sportradar Tennis v3 — schedules, rankings, competitor profiles (+ results/historical via season URN). */
export const sportradarProvider = createCredentialedProvider(sportradarAdapter);

/** SportsDataIO Tennis — schedules, results, players (rankings pending live-schema confirmation). */
export const sportsDataIoProvider = createCredentialedProvider(sportsDataIoAdapter);

/** API-Tennis (api-tennis.com) — fixtures, results, standings, players. */
export const apiTennisProvider = createCredentialedProvider(apiTennisAdapter);
