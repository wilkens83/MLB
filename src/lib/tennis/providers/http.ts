/* ============================================================================
   Shared HTTP infrastructure for the credentialed Tennis providers. This is the
   single place that talks to an upstream network: timeout, bounded retry with
   exponential backoff + jitter, `Retry-After` honoring, rate-limit metadata
   parsing, a typed error taxonomy, and — critically — SECRET-SAFE logging (an
   API key never appears in a log line or a thrown message).

   It is provider-agnostic: each provider supplies URL/auth/headers; this module
   performs the request and returns a typed result. Errors are VALUES, never
   thrown across the boundary, mirroring the graph engine's discipline.

   Server-only: reads nothing from `process.env` itself, but callers pass keys
   that must stay server-side. Do not import this into a client component.
   ========================================================================== */

import type { RateLimitState } from "./types";

/** Query-param names that carry a credential and must be redacted from logs. */
const SECRET_QUERY_KEYS = new Set(["apikey", "api_key", "key", "token", "secret"]);
/** Header names that carry a credential and must never be logged. */
const SECRET_HEADER_KEYS = new Set([
  "authorization",
  "ocp-apim-subscription-key",
  "x-api-key",
  "x-rapidapi-key",
]);

/**
 * Redact any credential-bearing query parameter from a URL so it is safe to log.
 * `?APIkey=abc123` → `?APIkey=REDACTED`. Invalid URLs are returned host-only.
 */
export function sanitizeUrl(rawUrl: string): string {
  try {
    const u = new URL(rawUrl);
    for (const k of [...u.searchParams.keys()]) {
      if (SECRET_QUERY_KEYS.has(k.toLowerCase())) u.searchParams.set(k, "REDACTED");
    }
    return u.toString();
  } catch {
    // Never leak a raw string that might embed a key — return only the scheme+host.
    const m = rawUrl.match(/^[a-z]+:\/\/[^/?#]+/i);
    return m ? `${m[0]}/…` : "invalid-url";
  }
}

/** Redact credential headers for logging/telemetry. */
export function sanitizeHeaders(headers: Record<string, string>): Record<string, string> {
  const out: Record<string, string> = {};
  for (const [k, v] of Object.entries(headers)) {
    out[k] = SECRET_HEADER_KEYS.has(k.toLowerCase()) ? "REDACTED" : v;
  }
  return out;
}

export type HttpErrorKind =
  | "auth" // 401 — bad/missing credential
  | "entitlement" // 403 — valid key, not permitted for this resource/tier
  | "not_found" // 404 — resource does not exist
  | "rate_limit" // 429 — quota exceeded
  | "client" // other 4xx — deterministic, do not retry
  | "server" // 5xx — transient, retryable
  | "timeout" // request exceeded the deadline
  | "network" // connection reset / DNS / TLS
  | "schema"; // caller-side: response did not validate (set by the adapter)

export interface HttpError {
  kind: HttpErrorKind;
  /** HTTP status when there was a response. */
  status?: number;
  /** Safe, secret-free message. */
  message: string;
  retryable: boolean;
  rateLimit?: RateLimitState;
}

export interface HttpSuccess<T> {
  ok: true;
  data: T;
  status: number;
  latencyMs: number;
  rateLimit?: RateLimitState;
}

export type HttpResult<T> = HttpSuccess<T> | { ok: false; error: HttpError };

export interface HttpRequest {
  url: string;
  headers?: Record<string, string>;
  /** Milliseconds before the request is aborted. */
  timeoutMs?: number;
  /** External cancellation. */
  signal?: AbortSignal;
}

export interface RetryConfig {
  maxAttempts: number;
  baseDelayMs: number;
  factor: number;
  /** Cap on any single backoff wait. */
  maxDelayMs: number;
  /** Cap on honoring an upstream Retry-After (avoid unbounded stalls). */
  maxRetryAfterMs: number;
}

export const DEFAULT_RETRY: RetryConfig = {
  maxAttempts: 3,
  baseDelayMs: 250,
  factor: 2,
  maxDelayMs: 4_000,
  maxRetryAfterMs: 10_000,
};

/** Injectable fetch + sleep so the client is deterministically unit-testable. */
export interface HttpDeps {
  fetch: typeof fetch;
  sleep?: (ms: number) => Promise<void>;
  now?: () => number;
  /** Jitter in [0,1); default Math.random. Set to () => 0 for deterministic tests. */
  random?: () => number;
  /** Structured, secret-free log sink. */
  log?: (msg: string, fields?: Record<string, unknown>) => void;
}

const realSleep = (ms: number) => new Promise<void>((r) => setTimeout(r, ms));

function classify(status: number): { kind: HttpErrorKind; retryable: boolean } {
  if (status === 401) return { kind: "auth", retryable: false };
  if (status === 403) return { kind: "entitlement", retryable: false };
  if (status === 404) return { kind: "not_found", retryable: false };
  if (status === 429) return { kind: "rate_limit", retryable: true };
  if (status >= 500) return { kind: "server", retryable: true };
  return { kind: "client", retryable: false };
}

/** Parse rate-limit hints from response headers (best-effort, provider-agnostic). */
export function parseRateLimit(headers: Headers): RateLimitState | undefined {
  const state: RateLimitState = {};
  const retryAfter = headers.get("retry-after");
  if (retryAfter) {
    const asSec = Number(retryAfter);
    if (Number.isFinite(asSec)) state.retryAfterSec = Math.max(0, asSec);
    else {
      const when = Date.parse(retryAfter);
      if (Number.isFinite(when)) state.retryAfterSec = Math.max(0, Math.round((when - Date.now()) / 1000));
    }
  }
  const remaining = headers.get("x-ratelimit-remaining") ?? headers.get("x-requests-remaining");
  if (remaining && Number.isFinite(Number(remaining))) state.remaining = Number(remaining);
  const reset = headers.get("x-ratelimit-reset");
  if (reset && Number.isFinite(Number(reset))) state.resetAt = Number(reset) * 1000;
  return Object.keys(state).length ? state : undefined;
}

function backoffDelay(attempt: number, cfg: RetryConfig, random: () => number): number {
  const exp = cfg.baseDelayMs * cfg.factor ** (attempt - 1);
  const capped = Math.min(exp, cfg.maxDelayMs);
  // Full jitter: a random point in [0, capped] avoids synchronized retries.
  return Math.round(capped * random());
}

async function once<T>(req: HttpRequest, deps: HttpDeps): Promise<HttpResult<T>> {
  const timeoutMs = req.timeoutMs ?? 8_000;
  const controller = new AbortController();
  const onExternalAbort = () => controller.abort();
  req.signal?.addEventListener("abort", onExternalAbort, { once: true });
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  const start = (deps.now ?? Date.now)();
  try {
    const res = await deps.fetch(req.url, {
      headers: req.headers,
      signal: controller.signal,
      // Provider adapters are strictly read-only.
      method: "GET",
    });
    const latencyMs = (deps.now ?? Date.now)() - start;
    const rateLimit = parseRateLimit(res.headers);
    if (!res.ok) {
      const { kind, retryable } = classify(res.status);
      return {
        ok: false,
        error: { kind, status: res.status, message: `HTTP ${res.status}`, retryable, rateLimit },
      };
    }
    let data: T;
    try {
      data = (await res.json()) as T;
    } catch {
      return { ok: false, error: { kind: "schema", status: res.status, message: "response was not valid JSON", retryable: false } };
    }
    return { ok: true, data, status: res.status, latencyMs, rateLimit };
  } catch (e) {
    const aborted = controller.signal.aborted;
    const external = req.signal?.aborted ?? false;
    if (aborted && !external) {
      return { ok: false, error: { kind: "timeout", message: `request exceeded ${timeoutMs}ms`, retryable: true } };
    }
    return {
      ok: false,
      error: { kind: "network", message: e instanceof Error ? e.message : "network error", retryable: !external },
    };
  } finally {
    clearTimeout(timer);
    req.signal?.removeEventListener("abort", onExternalAbort);
  }
}

/**
 * GET JSON with bounded retry. Retries only transient errors (server/network/
 * timeout/rate-limit), honors `Retry-After` (capped), and NEVER retries
 * deterministic 4xx (auth/entitlement/not_found/client). The returned error is
 * secret-free and its `rateLimit` is surfaced for the health registry.
 */
export async function httpGetJson<T>(
  req: HttpRequest,
  deps: HttpDeps,
  retry: RetryConfig = DEFAULT_RETRY,
): Promise<HttpResult<T>> {
  const sleep = deps.sleep ?? realSleep;
  const random = deps.random ?? Math.random;
  const log = deps.log ?? (() => {});
  let last: HttpResult<T> = { ok: false, error: { kind: "network", message: "not run", retryable: true } };

  for (let attempt = 1; attempt <= retry.maxAttempts; attempt++) {
    if (req.signal?.aborted) {
      return { ok: false, error: { kind: "network", message: "aborted", retryable: false } };
    }
    last = await once<T>(req, deps);
    if (last.ok) return last;

    const { error } = last;
    log("tennis http attempt failed", {
      url: sanitizeUrl(req.url),
      attempt,
      kind: error.kind,
      status: error.status,
    });
    if (!error.retryable || attempt === retry.maxAttempts) break;

    // Prefer an upstream Retry-After (capped) over computed backoff for 429.
    let delay = backoffDelay(attempt, retry, random);
    const retryAfterSec = error.rateLimit?.retryAfterSec;
    if (error.kind === "rate_limit" && retryAfterSec !== undefined) {
      delay = Math.min(retryAfterSec * 1000, retry.maxRetryAfterMs);
    }
    await sleep(delay);
  }
  return last;
}

/** Build provider provenance for a fetched record (secret-free). */
export function makeProvenance(args: {
  provider: string;
  providerRecordId?: string;
  sourceTimestamp?: string;
  now?: number;
  freshnessMs?: number;
}) {
  const capturedAt = args.now ?? Date.now();
  return {
    provider: args.provider,
    providerRecordId: args.providerRecordId,
    sourceTimestamp: args.sourceTimestamp,
    capturedAt,
    dataAsOf: capturedAt + (args.freshnessMs ?? 0),
  };
}
