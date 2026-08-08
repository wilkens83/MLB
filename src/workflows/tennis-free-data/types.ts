/* Contracts for the free-dataset acquisition workflow. Pure (zod). */

import { z } from "zod";
import type { FreeDataset } from "@/lib/tennis/data/freeDataset";

export const freeDataInputSchema = z.object({
  /** Point-in-time cutoff for leakage checks on rankings (optional). */
  featureCutoff: z.string().optional(),
});
export type FreeDataInput = z.infer<typeof freeDataInputSchema>;

export interface FreeDataDeps {
  /** Source loader — the cache/download seam. Default = bundled seed. Injected
      in tests so no network is touched. Returns a normalized dataset. */
  load: () => FreeDataset;
}

export const manifestOutputSchema = z.object({
  source: z.string(), datasetVersion: z.string(), sourceRef: z.string(),
  license: z.string(), licenseUse: z.string(), kind: z.string(),
  coverageStart: z.string(), coverageEnd: z.string(),
});

export const rawFilesOutputSchema = z.object({
  files: z.number().int().nonnegative(),
  fileHashes: z.record(z.string(), z.string()),
});

export const normalizeOutputSchema = z.object({
  matches: z.number().int().nonnegative(),
  players: z.number().int().nonnegative(),
  rankings: z.number().int().nonnegative(),
  parseFailures: z.number().int().nonnegative(),
});

export const identityOutputSchema = z.object({
  canonicalPlayers: z.number().int().nonnegative(),
  merged: z.number().int().nonnegative(),
});

export const verifyOutputSchema = z.object({
  verdict: z.enum(["PASS", "WARN", "REJECT"]),
  matchesAccepted: z.number().int().nonnegative(),
  matchesRejected: z.number().int().nonnegative(),
  rankingsVerdict: z.enum(["PASS", "WARN", "REJECT"]),
  issues: z.array(z.object({ code: z.string(), severity: z.string(), detail: z.string() })),
});

export const persistOutputSchema = z.object({
  observations: z.number().int().nonnegative(),
  sport: z.literal("tennis"),
});

export const healthReportSchema = z.object({
  status: z.enum(["ok", "degraded", "failed"]),
  source: z.string(),
  datasetVersion: z.string(),
  license: z.string(),
  licenseUse: z.string(),
  coverage: z.object({
    atpPlayers: z.number().int(), wtaPlayers: z.number().int(),
    atpMatches: z.number().int(), wtaMatches: z.number().int(),
    rankingObservations: z.number().int(),
    matchesWithServeStats: z.number().int(), matchesWithoutServeStats: z.number().int(),
    yearsCovered: z.array(z.number().int()),
    parseFailures: z.number().int(),
  }),
  verification: verifyOutputSchema,
  observationsPersisted: z.number().int(),
  warnings: z.array(z.string()).default([]),
});
export type FreeDataHealthReport = z.infer<typeof healthReportSchema>;
