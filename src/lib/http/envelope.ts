/* ============================================================================
   Shared HTTP response envelope. Success and failure share a consistent shape;
   internal error detail is NEVER leaked to clients. Pure (no framework import),
   so it is testable and reusable across route handlers.
   ========================================================================== */

export interface ResponseMeta {
  requestId: string;
  generatedAt: string;
  dataFreshness?: string;
  warnings?: string[];
}

export interface SuccessEnvelope<T> {
  data: T;
  meta: ResponseMeta;
  error: null;
}

export interface ErrorEnvelope {
  data: null;
  meta: Pick<ResponseMeta, "requestId" | "generatedAt">;
  error: { code: string; message: string; retryable: boolean };
}

export type Envelope<T> = SuccessEnvelope<T> | ErrorEnvelope;

function requestId(): string {
  // Non-cryptographic; only for correlating logs to a response.
  return Math.random().toString(36).slice(2, 10) + Date.now().toString(36);
}

export function success<T>(data: T, opts: { warnings?: string[]; dataFreshness?: string } = {}): SuccessEnvelope<T> {
  return {
    data,
    meta: { requestId: requestId(), generatedAt: new Date().toISOString(), dataFreshness: opts.dataFreshness, warnings: opts.warnings },
    error: null,
  };
}

export function failure(code: string, message: string, retryable = false): ErrorEnvelope {
  return {
    data: null,
    meta: { requestId: requestId(), generatedAt: new Date().toISOString() },
    error: { code, message, retryable },
  };
}

/** Map a workflow error code to an HTTP status without leaking internals. */
export function statusForErrorCode(code: string): number {
  switch (code) {
    case "VALIDATION": return 400;
    case "DATA_UNAVAILABLE": return 503;
    case "EXTERNAL_API":
    case "TIMEOUT":
    case "RATE_LIMIT": return 502;
    case "BUDGET_EXCEEDED": return 503;
    case "VERIFICATION": return 422;
    default: return 500;
  }
}
