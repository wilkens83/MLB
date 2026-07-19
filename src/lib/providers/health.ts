/* ============================================================================
   Provider health registry — tracks request counts, failures, latency and
   last-success timestamps per data source, feeding the data-health page.
   ========================================================================== */

import type { ProviderHealth } from "./types";

const registry = new Map<string, ProviderHealth>();

function ensure(name: string): ProviderHealth {
  let h = registry.get(name);
  if (!h) {
    h = { name, failures: 0, requests: 0, avgResponseMs: 0 };
    registry.set(name, h);
  }
  return h;
}

export function recordSuccess(name: string, ms: number) {
  const h = ensure(name);
  h.requests++;
  h.lastSuccessAt = Date.now();
  h.avgResponseMs = h.avgResponseMs === 0 ? ms : h.avgResponseMs * 0.8 + ms * 0.2;
}

export function recordFailure(name: string) {
  const h = ensure(name);
  h.requests++;
  h.failures++;
  h.lastFailureAt = Date.now();
}

export function getAllHealth(): ProviderHealth[] {
  return [...registry.values()];
}

export function getHealth(name: string): ProviderHealth | undefined {
  return registry.get(name);
}
