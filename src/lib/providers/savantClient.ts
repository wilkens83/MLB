/* ============================================================================
   Baseball Savant client — fetches public Statcast leaderboards as CSV, with an
   in-memory TTL cache, request dedup, timeout, retry, and health tracking.
   Savant has no public JSON prop API; the custom leaderboard CSV is the stable,
   documented surface, so we parse CSV here.
   ========================================================================== */

import { recordSuccess, recordFailure } from "./health";

const BASE = "https://baseballsavant.mlb.com";
const PROVIDER = "baseball-savant";

interface CacheEntry {
  expires: number;
  value: string;
}
const cache = new Map<string, CacheEntry>();
const inflight = new Map<string, Promise<string>>();

/** Bound the CSV cache (leaderboards are large); evict expired then oldest. */
const MAX_CACHE_ENTRIES = 100;

function setCache(key: string, entry: CacheEntry): void {
  if (cache.size >= MAX_CACHE_ENTRIES && !cache.has(key)) {
    const now = Date.now();
    for (const [k, v] of cache) {
      if (v.expires <= now) cache.delete(k);
    }
    while (cache.size >= MAX_CACHE_ENTRIES) {
      const oldest = cache.keys().next().value;
      if (oldest === undefined) break;
      cache.delete(oldest);
    }
  }
  cache.set(key, entry);
}

export class SavantError extends Error {
  constructor(
    message: string,
    readonly status?: number,
  ) {
    super(message);
    this.name = "SavantError";
  }
}

async function fetchText(url: string, timeout: number, retries: number): Promise<string> {
  let lastErr: unknown;
  for (let attempt = 0; attempt <= retries; attempt++) {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), timeout);
    const start = Date.now();
    try {
      const res = await fetch(url, {
        signal: controller.signal,
        headers: { Accept: "text/csv,*/*", "User-Agent": "diamond-mlb-props/1.0" },
      });
      clearTimeout(timer);
      if (!res.ok) {
        if (res.status < 500 || attempt === retries) throw new SavantError(`Savant ${res.status}`, res.status);
        throw new SavantError(`Savant ${res.status}`, res.status);
      }
      const text = await res.text();
      recordSuccess(PROVIDER, Date.now() - start);
      return text;
    } catch (err) {
      clearTimeout(timer);
      lastErr = err;
      if (err instanceof SavantError && err.status && err.status < 500) {
        recordFailure(PROVIDER);
        throw err;
      }
      if (attempt < retries) await new Promise((r) => setTimeout(r, 300 * 2 ** attempt));
    }
  }
  recordFailure(PROVIDER);
  throw lastErr instanceof Error ? lastErr : new SavantError(String(lastErr));
}

/** GET a Savant CSV path (relative to the host) with caching + dedup. */
export async function savantCsv(path: string, ttlSeconds = 6 * 3600): Promise<string> {
  const url = path.startsWith("http") ? path : `${BASE}${path}`;
  const now = Date.now();
  const hit = cache.get(url);
  if (hit && hit.expires > now) return hit.value;
  const pending = inflight.get(url);
  if (pending) return pending;

  const promise = fetchText(url, 15000, 2)
    .then((value) => {
      setCache(url, { value, expires: now + ttlSeconds * 1000 });
      return value;
    })
    .finally(() => inflight.delete(url));
  inflight.set(url, promise);
  return promise;
}

/* --------------------------------- CSV ------------------------------------ */

/** Parse a single CSV line, honoring double-quoted fields containing commas. */
export function parseCsvLine(line: string): string[] {
  const out: string[] = [];
  let cur = "";
  let inQuotes = false;
  for (let i = 0; i < line.length; i++) {
    const ch = line[i];
    if (inQuotes) {
      if (ch === '"') {
        if (line[i + 1] === '"') {
          cur += '"';
          i++;
        } else inQuotes = false;
      } else cur += ch;
    } else if (ch === '"') inQuotes = true;
    else if (ch === ",") {
      out.push(cur);
      cur = "";
    } else cur += ch;
  }
  out.push(cur);
  return out;
}

/** Parse a full CSV string into an array of header→value records. */
export function parseCsv(text: string): Record<string, string>[] {
  const lines = text.split(/\r?\n/).filter((l) => l.trim().length > 0);
  if (lines.length < 2) return [];
  const headers = parseCsvLine(lines[0]).map((h) => h.trim());
  const rows: Record<string, string>[] = [];
  for (let i = 1; i < lines.length; i++) {
    const cells = parseCsvLine(lines[i]);
    const rec: Record<string, string> = {};
    headers.forEach((h, j) => (rec[h] = (cells[j] ?? "").trim()));
    rows.push(rec);
  }
  return rows;
}

export { PROVIDER as SAVANT_PROVIDER };
