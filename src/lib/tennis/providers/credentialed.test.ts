import { describe, it, expect, beforeEach, afterEach } from "bun:test";
import { createCredentialedProvider } from "./credentialedProvider";
import { apiTennisAdapter } from "./adapters/apiTennis";
import { __resetHealth, getTennisHealth } from "./health";
import { API_TENNIS_FIXTURES, API_TENNIS_STANDINGS } from "./adapters/fixtures";
import type { HttpDeps } from "./http";

const ENV = "API_TENNIS_API_KEY";
const jsonResponse = (body: unknown, init?: { status?: number; headers?: Record<string, string> }) =>
  new Response(JSON.stringify(body), { status: init?.status ?? 200, headers: init?.headers });
const http = (fetch: HttpDeps["fetch"]): Partial<HttpDeps> => ({ fetch, sleep: async () => {}, random: () => 0 });

beforeEach(() => __resetHealth());
afterEach(() => { delete process.env[ENV]; });

describe("credentialed factory — inert without a key", () => {
  it("stays unconfigured and returns empty/null, never fabricating", async () => {
    delete process.env[ENV];
    const p = createCredentialedProvider(apiTennisAdapter, { http: http(async () => jsonResponse(API_TENNIS_FIXTURES)) });
    expect(p.status()).toBe("unconfigured");
    expect(await p.getSchedule({ dateIso: "2026-08-08" })).toEqual([]);
    expect(await p.getPlayer("x")).toBeNull();
  });
});

describe("credentialed factory — real path with a key", () => {
  it("reaches READY only after a verified live call (a key alone is not enough)", async () => {
    process.env[ENV] = "test-key";
    const p = createCredentialedProvider(apiTennisAdapter, {
      http: http(async () => jsonResponse(API_TENNIS_STANDINGS)),
      now: () => 1000,
    });
    // Key present but no call yet ⇒ configured_unverified (NOT ready).
    expect(p.status()).toBe("configured_unverified");
    const rankings = await p.getRankings("atp");
    expect(rankings.length).toBe(2);
    expect(p.status()).toBe("ready");
    expect(p.capabilityStatus?.().rankings).toBe("verified");
    expect(getTennisHealth("api-tennis")?.lastVerifiedAt).toBeDefined();
  });

  it("maps 401 to an error status and returns empty (AUTH_INVALID)", async () => {
    process.env[ENV] = "bad-key";
    const p = createCredentialedProvider(apiTennisAdapter, { http: http(async () => jsonResponse({}, { status: 401 })) });
    const out = await p.getSchedule({ dateIso: "2026-08-08" });
    expect(out).toEqual([]);
    expect(p.status()).toBe("error");
    expect(getTennisHealth("api-tennis")?.detail).toContain("AUTH_INVALID");
  });

  it("maps 403 to entitlement_missing per capability", async () => {
    process.env[ENV] = "k";
    const p = createCredentialedProvider(apiTennisAdapter, { http: http(async () => jsonResponse({}, { status: 403 })) });
    await p.getRankings("atp");
    expect(p.status()).toBe("entitlement_missing");
    expect(p.capabilityStatus?.().rankings).toBe("entitlement_missing");
  });

  it("does NOT silently convert a schema mismatch into empty-valid data", async () => {
    process.env[ENV] = "k";
    const p = createCredentialedProvider(apiTennisAdapter, { http: http(async () => jsonResponse({ garbage: true })) });
    const out = await p.getSchedule({ dateIso: "2026-08-08" });
    expect(out).toEqual([]); // interface returns [], but health carries the truth:
    expect(p.status()).toBe("error");
    expect(getTennisHealth("api-tennis")?.detail).toContain("PROVIDER_SCHEMA_MISMATCH");
  });

  it("maps a persistent 429 to rate_limited and records the rate-limit state", async () => {
    process.env[ENV] = "k";
    const p = createCredentialedProvider(apiTennisAdapter, {
      http: http(async () => jsonResponse({}, { status: 429, headers: { "Retry-After": "5" } })),
      retry: { maxAttempts: 2, baseDelayMs: 1, factor: 2, maxDelayMs: 5, maxRetryAfterMs: 10 },
    });
    await p.getRankings("atp");
    expect(p.status()).toBe("rate_limited");
    expect(getTennisHealth("api-tennis")?.rateLimit?.retryAfterSec).toBe(5);
  });

  it("degrades (not ready) when mapped data fails independent verification", async () => {
    process.env[ENV] = "k";
    // A completed match where BOTH sides are the same player id ⇒ PLAYER_VS_SELF reject.
    const selfPlay = { success: 1, result: [{
      event_key: 1, event_first_player: "A", first_player_key: 5,
      event_second_player: "A", second_player_key: 5, event_status: "Finished",
      event_winner: "First Player", event_type_type: "Atp Singles", tournament_name: "X",
    }] };
    const p = createCredentialedProvider(apiTennisAdapter, { http: http(async () => jsonResponse(selfPlay)) });
    await p.getMatchResults({ tour: "atp", season: 2026 });
    expect(p.status()).toBe("degraded");
    expect(p.capabilityStatus?.().results).toBe("supported");
  });
});
