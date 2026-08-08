import { describe, it, expect } from "bun:test";
import {
  httpGetJson, sanitizeUrl, sanitizeHeaders, parseRateLimit, type HttpDeps,
} from "./http";

const noWait: Pick<HttpDeps, "sleep" | "random"> = { sleep: async () => {}, random: () => 0 };
const jsonResponse = (body: unknown, init?: { status?: number; headers?: Record<string, string> }) =>
  new Response(JSON.stringify(body), { status: init?.status ?? 200, headers: init?.headers });

describe("sanitizeUrl", () => {
  it("redacts credential query params, keeps the rest", () => {
    const s = sanitizeUrl("https://api.api-tennis.com/tennis/?method=get_fixtures&APIkey=SECRET123&date_start=2026-08-08");
    expect(s).toContain("method=get_fixtures");
    expect(s).toContain("APIkey=REDACTED");
    expect(s).not.toContain("SECRET123");
  });
  it("never leaks a key from an unparseable string", () => {
    expect(sanitizeUrl("not a url APIkey=SECRET")).not.toContain("SECRET");
  });
});

describe("sanitizeHeaders", () => {
  it("redacts credential headers only", () => {
    const h = sanitizeHeaders({ "Ocp-Apim-Subscription-Key": "SECRET", Accept: "application/json" });
    expect(h["Ocp-Apim-Subscription-Key"]).toBe("REDACTED");
    expect(h.Accept).toBe("application/json");
  });
});

describe("parseRateLimit", () => {
  it("parses Retry-After seconds and remaining quota", () => {
    const rl = parseRateLimit(new Headers({ "Retry-After": "30", "x-ratelimit-remaining": "5" }));
    expect(rl?.retryAfterSec).toBe(30);
    expect(rl?.remaining).toBe(5);
  });
});

describe("httpGetJson", () => {
  it("returns parsed JSON on success with latency", async () => {
    const deps: HttpDeps = { fetch: async () => jsonResponse({ hello: "world" }), ...noWait };
    const res = await httpGetJson<{ hello: string }>({ url: "https://x.test/a" }, deps);
    expect(res.ok).toBe(true);
    if (res.ok) expect(res.data.hello).toBe("world");
  });

  it("does NOT retry a 401 (auth) — deterministic 4xx", async () => {
    let calls = 0;
    const deps: HttpDeps = { fetch: async () => { calls++; return jsonResponse({}, { status: 401 }); }, ...noWait };
    const res = await httpGetJson({ url: "https://x.test/a" }, deps, { maxAttempts: 3, baseDelayMs: 1, factor: 2, maxDelayMs: 10, maxRetryAfterMs: 10 });
    expect(res.ok).toBe(false);
    if (!res.ok) expect(res.error.kind).toBe("auth");
    expect(calls).toBe(1);
  });

  it("maps 403 to entitlement and does not retry", async () => {
    let calls = 0;
    const deps: HttpDeps = { fetch: async () => { calls++; return jsonResponse({}, { status: 403 }); }, ...noWait };
    const res = await httpGetJson({ url: "https://x.test/a" }, deps);
    expect(res.ok).toBe(false);
    if (!res.ok) expect(res.error.kind).toBe("entitlement");
    expect(calls).toBe(1);
  });

  it("retries a 500 then succeeds", async () => {
    let calls = 0;
    const deps: HttpDeps = {
      fetch: async () => { calls++; return calls < 3 ? jsonResponse({}, { status: 500 }) : jsonResponse({ ok: 1 }); },
      ...noWait,
    };
    const res = await httpGetJson<{ ok: number }>({ url: "https://x.test/a" }, deps, { maxAttempts: 3, baseDelayMs: 1, factor: 2, maxDelayMs: 10, maxRetryAfterMs: 10 });
    expect(res.ok).toBe(true);
    expect(calls).toBe(3);
  });

  it("honors Retry-After on 429 (bounded) and surfaces rateLimit", async () => {
    let calls = 0;
    const waited: number[] = [];
    const deps: HttpDeps = {
      fetch: async () => { calls++; return calls < 2 ? jsonResponse({}, { status: 429, headers: { "Retry-After": "2" } }) : jsonResponse({ ok: 1 }); },
      sleep: async (ms) => { waited.push(ms); },
      random: () => 0,
    };
    const res = await httpGetJson({ url: "https://x.test/a" }, deps, { maxAttempts: 2, baseDelayMs: 1, factor: 2, maxDelayMs: 10, maxRetryAfterMs: 5000 });
    expect(res.ok).toBe(true);
    expect(waited[0]).toBe(2000); // honored Retry-After (2s), within the 5s cap
  });

  it("classifies non-JSON as a schema error", async () => {
    const deps: HttpDeps = { fetch: async () => new Response("<html>not json</html>", { status: 200 }), ...noWait };
    const res = await httpGetJson({ url: "https://x.test/a" }, deps);
    expect(res.ok).toBe(false);
    if (!res.ok) expect(res.error.kind).toBe("schema");
  });

  it("times out a hanging request", async () => {
    const deps: HttpDeps = {
      fetch: (_url, init) => new Promise((_res, rej) => {
        (init?.signal as AbortSignal | undefined)?.addEventListener("abort", () => rej(new DOMException("aborted", "AbortError")));
      }) as unknown as typeof fetch,
      ...noWait,
    };
    const res = await httpGetJson({ url: "https://x.test/a", timeoutMs: 20 }, deps, { maxAttempts: 1, baseDelayMs: 1, factor: 2, maxDelayMs: 10, maxRetryAfterMs: 10 });
    expect(res.ok).toBe(false);
    if (!res.ok) expect(res.error.kind).toBe("timeout");
  });

  it("never logs a raw key", async () => {
    const logs: string[] = [];
    const deps: HttpDeps = {
      fetch: async () => jsonResponse({}, { status: 500 }),
      sleep: async () => {}, random: () => 0,
      log: (msg, fields) => logs.push(msg + JSON.stringify(fields ?? {})),
    };
    await httpGetJson({ url: "https://x.test/a?APIkey=TOPSECRET" }, deps, { maxAttempts: 2, baseDelayMs: 1, factor: 2, maxDelayMs: 10, maxRetryAfterMs: 10 });
    expect(logs.join("\n")).not.toContain("TOPSECRET");
  });
});
