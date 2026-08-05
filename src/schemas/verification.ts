/* ============================================================================
   Verification contracts (Zod). An independent verification result is a list of
   deterministic checks with a pass/fail and detail, plus the rejection reasons
   that make a firm recommendation impossible. Pure (zod only).
   ========================================================================== */

import { z } from "zod";

export const verificationCheckSchema = z.object({
  name: z.string(),
  passed: z.boolean(),
  /** Human-readable reason (safe to surface). */
  detail: z.string().optional(),
  /** Machine code for aggregation. */
  code: z.string().optional(),
});
export type VerificationCheck = z.infer<typeof verificationCheckSchema>;

export const verificationResultSchema = z.object({
  passed: z.boolean(),
  checks: z.array(verificationCheckSchema),
  /** Codes that force a rejection (empty when passed). */
  rejections: z.array(z.string()).default([]),
});
export type VerificationResult = z.infer<typeof verificationResultSchema>;
