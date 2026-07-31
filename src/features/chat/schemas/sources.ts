/* ============================================================================
   Data-source references + freshness. Every chat response that makes a data
   claim carries these so the UI can cite where each number came from and how
   fresh it is. Freshness is derived from an "as of" timestamp per source type.
   ========================================================================== */

import { z } from "zod";

export const freshnessStatusSchema = z.enum([
  "live",
  "fresh",
  "stale",
  "historical",
  "unknown",
]);
export type FreshnessStatus = z.infer<typeof freshnessStatusSchema>;

export const dataSourceTypeSchema = z.enum([
  "mlb-stats-api",
  "baseball-savant",
  "diamond-edge-model",
  "prizepicks-import",
  "database",
]);
export type DataSourceType = z.infer<typeof dataSourceTypeSchema>;

export const dataSourceReferenceSchema = z.object({
  id: z.string(),
  name: z.string(),
  type: dataSourceTypeSchema,
  endpoint: z.string().optional(),
  /** ISO timestamp the data was retrieved by the server. */
  retrievedAt: z.string(),
  /** ISO timestamp the underlying data is "as of" (may predate retrieval). */
  dataAsOf: z.string().optional(),
  modelVersion: z.string().optional(),
  freshnessStatus: freshnessStatusSchema,
});
export type DataSourceReference = z.infer<typeof dataSourceReferenceSchema>;

/** Freshness buckets by age, tuned per source type (live game vs. season CSV). */
export function freshnessFor(
  type: DataSourceType,
  dataAsOfMs: number | undefined,
  now = Date.now(),
): FreshnessStatus {
  if (dataAsOfMs === undefined) return "unknown";
  const ageMs = Math.max(0, now - dataAsOfMs);
  const min = 60_000;
  switch (type) {
    case "mlb-stats-api":
      // Schedule/live: minutes = live, up to ~15m fresh, else stale.
      if (ageMs < 2 * min) return "live";
      if (ageMs < 15 * min) return "fresh";
      return "stale";
    case "baseball-savant":
      // Season CSVs update daily; hours are still fresh.
      if (ageMs < 12 * 60 * min) return "fresh";
      return "stale";
    case "diamond-edge-model":
      // Model output is as-fresh-as its inputs; treat a just-run projection as fresh.
      return ageMs < 15 * min ? "fresh" : "stale";
    case "prizepicks-import":
      // Manually imported — never "live". Fresh for the day, else stale.
      if (ageMs < 6 * 60 * min) return "fresh";
      return "stale";
    case "database":
      return "historical";
    default:
      return "unknown";
  }
}

let sourceSeq = 0;
/** Build a source reference, deriving freshnessStatus from `dataAsOf`. */
export function makeSource(input: {
  name: string;
  type: DataSourceType;
  endpoint?: string;
  retrievedAt?: number;
  dataAsOf?: number;
  modelVersion?: string;
}): DataSourceReference {
  const retrieved = input.retrievedAt ?? Date.now();
  return {
    id: `src-${input.type}-${sourceSeq++}`,
    name: input.name,
    type: input.type,
    endpoint: input.endpoint,
    retrievedAt: new Date(retrieved).toISOString(),
    dataAsOf: input.dataAsOf ? new Date(input.dataAsOf).toISOString() : undefined,
    modelVersion: input.modelVersion,
    freshnessStatus: freshnessFor(input.type, input.dataAsOf, retrieved),
  };
}

/** De-duplicate sources by (type, name, endpoint), keeping the freshest. */
export function dedupeSources(sources: DataSourceReference[]): DataSourceReference[] {
  const byKey = new Map<string, DataSourceReference>();
  for (const s of sources) {
    const key = `${s.type}|${s.name}|${s.endpoint ?? ""}`;
    const existing = byKey.get(key);
    if (!existing) {
      byKey.set(key, s);
      continue;
    }
    const a = existing.dataAsOf ? Date.parse(existing.dataAsOf) : 0;
    const b = s.dataAsOf ? Date.parse(s.dataAsOf) : 0;
    if (b > a) byKey.set(key, s);
  }
  return [...byKey.values()];
}
