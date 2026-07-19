/* ============================================================================
   Boundary validation helpers. External responses are validated with Zod; on
   failure we log once and return a caller-supplied fallback so a malformed or
   partial upstream payload degrades gracefully instead of throwing.
   ========================================================================== */

import type { z } from "zod";

let validationFailures = 0;

export function getValidationFailureCount() {
  return validationFailures;
}

/**
 * Validate `data` against `schema`. On success returns the parsed value; on
 * failure increments the failure counter, logs a concise message, and returns
 * `fallback`.
 */
export function safeValidate<S extends z.ZodTypeAny>(
  schema: S,
  data: unknown,
  fallback: z.infer<S>,
  context = "external",
): z.infer<S> {
  const result = schema.safeParse(data);
  if (result.success) return result.data;
  validationFailures++;
  if (process.env.NODE_ENV !== "production") {
    const first = result.error.issues[0];
    console.warn(`[validate:${context}] ${first?.path?.join(".") ?? "?"}: ${first?.message ?? "invalid"}`);
  }
  return fallback;
}
