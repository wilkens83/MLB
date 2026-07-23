/* ============================================================================
   Named live-provider instances. Each is inert until its API key env var is set
   AND its upstream mapping is verified against the real API (see
   credentialedProvider.ts). Endpoints/licensing are documented in
   docs/tennis/PROVIDERS.md.
   ========================================================================== */

import { createCredentialedProvider } from "./credentialedProvider";

/** Sportradar Tennis v3 — schedules, results, rankings, competitor profiles. */
export const sportradarProvider = createCredentialedProvider({
  name: "sportradar",
  baseUrl: "https://api.sportradar.com/tennis/trial/v3",
  apiKeyEnvVar: "SPORTRADAR_TENNIS_API_KEY",
  capabilities: { schedule: true, results: true, rankings: true, players: true, historical: true },
  note: "Commercial license required. Trial + production tiers. Key is server-side only.",
});

/** SportsDataIO Tennis — schedules, box scores, rankings. */
export const sportsDataIoProvider = createCredentialedProvider({
  name: "sportsdataio",
  baseUrl: "https://api.sportsdata.io/v3/tennis",
  apiKeyEnvVar: "SPORTSDATAIO_TENNIS_API_KEY",
  capabilities: { schedule: true, results: true, rankings: true, players: true, historical: false },
  note: "Commercial license required. Ocp-Apim-Subscription-Key header auth.",
});

/** API-Tennis (api-tennis.com) — fixtures, results, standings. */
export const apiTennisProvider = createCredentialedProvider({
  name: "api-tennis",
  baseUrl: "https://api.api-tennis.com/tennis",
  apiKeyEnvVar: "API_TENNIS_API_KEY",
  capabilities: { schedule: true, results: true, rankings: true, players: true, historical: false },
  note: "Freemium; key passed as query param server-side. Rate-limited on free tier.",
});
