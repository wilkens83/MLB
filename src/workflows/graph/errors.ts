/* Workflow error taxonomy. Every error carries a stable `code`, a safe
   `message`, and a `retryable` flag. Pure, dependency-free. */

export type WorkflowErrorCode =
  | "VALIDATION"
  | "EXTERNAL_API"
  | "TIMEOUT"
  | "RATE_LIMIT"
  | "DATA_UNAVAILABLE"
  | "MODEL"
  | "SIMULATION"
  | "VERIFICATION"
  | "BUDGET_EXCEEDED"
  | "CANCELLED"
  | "INTERNAL";

export interface WorkflowError {
  code: WorkflowErrorCode;
  message: string;
  retryable: boolean;
  /** Optional structured detail (never contains secrets). */
  detail?: Record<string, unknown>;
}

function make(code: WorkflowErrorCode, retryable: boolean) {
  return (message: string, detail?: Record<string, unknown>): WorkflowError => ({
    code, message, retryable, detail,
  });
}

export const validationError = make("VALIDATION", false);
export const externalApiError = make("EXTERNAL_API", true);
export const timeoutError = make("TIMEOUT", true);
export const rateLimitError = make("RATE_LIMIT", true);
export const dataUnavailableError = make("DATA_UNAVAILABLE", true);
export const modelError = make("MODEL", false);
export const simulationError = make("SIMULATION", false);
export const verificationError = make("VERIFICATION", false);
export const budgetExceededError = make("BUDGET_EXCEEDED", false);
export const cancelledError = make("CANCELLED", false);
export const internalError = make("INTERNAL", false);

/** True when the executor may retry a node given its error. */
export function isRetryable(e: WorkflowError): boolean {
  return e.retryable;
}
