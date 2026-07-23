/* ============================================================================
   Tennis provider health registry — request counts, failures, latency, and last
   success/failure timestamps per source, plus the declared readiness status.
   Feeds the (future) tennis data-health surface and the registry's failover.
   Mirrors `src/lib/providers/health.ts`.
   ========================================================================== */

import type { ProviderStatus, TennisProviderHealth } from "./types";

const registry = new Map<string, TennisProviderHealth>();

function ensure(name: string): TennisProviderHealth {
  let h = registry.get(name);
  if (!h) {
    h = { name, status: "unconfigured", failures: 0, requests: 0, avgResponseMs: 0 };
    registry.set(name, h);
  }
  return h;
}

export function setStatus(name: string, status: ProviderStatus, detail?: string) {
  const h = ensure(name);
  h.status = status;
  if (detail !== undefined) h.detail = detail;
}

export function recordSuccess(name: string, ms: number) {
  const h = ensure(name);
  h.requests++;
  h.lastSuccessAt = Date.now();
  h.avgResponseMs = h.avgResponseMs === 0 ? ms : h.avgResponseMs * 0.8 + ms * 0.2;
}

export function recordFailure(name: string, detail?: string) {
  const h = ensure(name);
  h.requests++;
  h.failures++;
  h.lastFailureAt = Date.now();
  if (detail !== undefined) h.detail = detail;
}

export function getAllTennisHealth(): TennisProviderHealth[] {
  return [...registry.values()];
}

export function getTennisHealth(name: string): TennisProviderHealth | undefined {
  return registry.get(name);
}

/** Test-only: clear the registry between test cases. */
export function __resetHealth() {
  registry.clear();
}
