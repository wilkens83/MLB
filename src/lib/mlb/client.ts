/* ============================================================================
   MLB Stats API client — thin fetch wrapper with an in-memory TTL cache,
   request de-duplication, timeout, and retry with backoff. No API key needed;
   the MLB Stats API (statsapi.mlb.com) is public.
   ========================================================================== */

import { recordSuccess, recordFailure } from "@/lib/providers/health";

const BASE = "https://statsapi.mlb.com/api";

interface CacheEntry {
  expires: number;
  value: unknown;
}

const cache = new Map<string, CacheEntry>();
const inflight = new Map<string, Promise<unknown>>();

export interface FetchOptions {
  /** Cache TTL in seconds. 0 disables caching. */
  ttl?: number;
  /** Per-request timeout in ms. */
  timeout?: number;
  /** API version segment, e.g. "v1" (default) or "v1.1". */
  version?: string;
  retries?: number;
}

export class MlbApiError extends Error {
  constructor(
    message: string,
    readonly status?: number,
    readonly path?: string,
  ) {
    super(message);
    this.name = "MlbApiError";
  }
}

function buildUrl(path: string, version: string): string {
  const clean = path.startsWith("/") ? path : `/${path}`;
  return `${BASE}/${version}${clean}`;
}

const PROVIDER = "mlb-stats-api";

async function doFetch<T>(url: string, timeout: number, retries: number): Promise<T> {
  let lastErr: unknown;
  for (let attempt = 0; attempt <= retries; attempt++) {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), timeout);
    const start = Date.now();
    try {
      const res = await fetch(url, {
        signal: controller.signal,
        headers: { Accept: "application/json", "User-Agent": "diamond-mlb-props/1.0" },
      });
      clearTimeout(timer);
      if (!res.ok) {
        // 4xx are not retried; 5xx are.
        if (res.status < 500 || attempt === retries) {
          recordFailure(PROVIDER);
          throw new MlbApiError(`MLB API ${res.status} for ${url}`, res.status, url);
        }
        throw new MlbApiError(`MLB API ${res.status}`, res.status, url);
      }
      const json = (await res.json()) as T;
      recordSuccess(PROVIDER, Date.now() - start);
      return json;
    } catch (err) {
      clearTimeout(timer);
      lastErr = err;
      if (err instanceof MlbApiError && err.status && err.status < 500) throw err;
      if (attempt < retries) {
        await new Promise((r) => setTimeout(r, 250 * 2 ** attempt));
      } else {
        recordFailure(PROVIDER);
      }
    }
  }
  throw lastErr instanceof Error ? lastErr : new MlbApiError(String(lastErr));
}

/**
 * GET a JSON resource from the MLB Stats API with caching + dedup.
 * `path` is relative to the version segment, e.g. "/schedule?sportId=1".
 */
export async function mlbGet<T>(path: string, opts: FetchOptions = {}): Promise<T> {
  const { ttl = 60, timeout = 12000, version = "v1", retries = 2 } = opts;
  const url = buildUrl(path, version);
  const now = Date.now();

  if (ttl > 0) {
    const hit = cache.get(url);
    if (hit && hit.expires > now) return hit.value as T;
    const pending = inflight.get(url);
    if (pending) return pending as Promise<T>;
  }

  const promise = doFetch<T>(url, timeout, retries)
    .then((value) => {
      if (ttl > 0) cache.set(url, { value, expires: now + ttl * 1000 });
      return value;
    })
    .finally(() => {
      inflight.delete(url);
    });

  if (ttl > 0) inflight.set(url, promise);
  return promise;
}

/** Clear the entire in-memory cache (used by admin/cache tooling). */
export function clearMlbCache(): number {
  const n = cache.size;
  cache.clear();
  return n;
}

export function mlbCacheStats() {
  const now = Date.now();
  let live = 0;
  for (const e of cache.values()) if (e.expires > now) live++;
  return { total: cache.size, live, stale: cache.size - live };
}
