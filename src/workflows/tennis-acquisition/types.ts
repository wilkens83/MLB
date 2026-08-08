/* Tennis data-acquisition workflow contracts (Zod). The graph acquires a day's
   fixtures across every configured provider, reconciles them, and independently
   verifies the merged set before it becomes output. Pure (zod + domain types). */

import { z } from "zod";
import type { TennisDataProvider } from "@/lib/tennis/providers/types";

export const tennisAcquisitionInputSchema = z.object({
  dateIso: z.string().regex(/^\d{4}-\d{2}-\d{2}$/, "expected YYYY-MM-DD"),
  tour: z.enum(["atp", "wta", "challenger", "itf"]).optional(),
  /** Permit fixture/dev providers to satisfy the request (tests/dev only). */
  allowFixtures: z.boolean().default(false),
});
export type TennisAcquisitionInput = z.input<typeof tennisAcquisitionInputSchema>;
export type TennisAcquisitionParsed = z.infer<typeof tennisAcquisitionInputSchema>;

export interface TennisAcquisitionDeps {
  /** Providers in priority order. */
  providers: TennisDataProvider[];
}

export const providerHealthRowSchema = z.object({
  name: z.string(),
  status: z.string(),
  routable: z.boolean(),
});
export const providerHealthOutputSchema = z.object({
  providers: z.array(providerHealthRowSchema),
});

export const selectOutputSchema = z.object({
  selected: z.array(z.string()),
  reasons: z.array(z.object({ provider: z.string(), reason: z.string() })),
});

/** One provider branch result — ALWAYS ok (usable) so a failing branch never
    cascade-skips the fan-in; the branch carries its own success flag. */
export const providerFetchOutputSchema = z.object({
  provider: z.string(),
  ok: z.boolean(),
  status: z.string(),
  count: z.number().int().nonnegative(),
  /** Mapped matches (already validated + canonicalized by the provider). */
  matches: z.array(z.unknown()),
});

export const discrepancySchema = z.object({
  matchKey: z.string(),
  field: z.string(),
  values: z.record(z.string(), z.string()),
  severity: z.enum(["info", "warning"]),
});

export const reconcileOutputSchema = z.object({
  matches: z.array(z.unknown()),
  discrepancies: z.array(discrepancySchema),
  contributingProviders: z.array(z.string()),
});

export const verifyOutputSchema = z.object({
  verdict: z.enum(["PASS", "WARN", "REJECT"]),
  accepted: z.number().int().nonnegative(),
  rejected: z.number().int().nonnegative(),
  issues: z.array(z.object({ code: z.string(), severity: z.string(), detail: z.string(), ref: z.string().optional() })),
});

export const acquisitionResultSchema = z.object({
  status: z.enum(["ok", "degraded", "data_unavailable"]),
  dateIso: z.string(),
  matches: z.array(z.unknown()),
  providerSelection: z.array(z.object({ provider: z.string(), reason: z.string() })),
  contributingProviders: z.array(z.string()),
  discrepancies: z.array(discrepancySchema),
  verification: verifyOutputSchema,
  warnings: z.array(z.string()).default([]),
});
export type AcquisitionResult = z.infer<typeof acquisitionResultSchema>;
