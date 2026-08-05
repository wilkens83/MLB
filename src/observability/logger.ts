/* ============================================================================
   Tiny structured logger. Emits JSON lines; never logs secrets or full user
   payloads (only ids, codes, counts, timings). Dependency-free so it runs under
   Bun and in the browser. Level is controlled by LOG_LEVEL (default "info").
   ========================================================================== */

export type LogLevel = "debug" | "info" | "warn" | "error";

const ORDER: Record<LogLevel, number> = { debug: 10, info: 20, warn: 30, error: 40 };

/** Keys whose values are redacted if they ever appear in log fields. */
const SECRET_KEYS = /(key|token|secret|password|authorization|service_role)/i;

function threshold(): number {
  const env = typeof process !== "undefined" ? process.env?.LOG_LEVEL : undefined;
  const lvl = (env as LogLevel) || "info";
  return ORDER[lvl] ?? ORDER.info;
}

function redact(fields?: Record<string, unknown>): Record<string, unknown> | undefined {
  if (!fields) return undefined;
  const out: Record<string, unknown> = {};
  for (const [k, v] of Object.entries(fields)) {
    out[k] = SECRET_KEYS.test(k) ? "[redacted]" : v;
  }
  return out;
}

function emit(level: LogLevel, msg: string, fields?: Record<string, unknown>) {
  if (ORDER[level] < threshold()) return;
  const line = JSON.stringify({ level, msg, ts: new Date().toISOString(), ...redact(fields) });
  // eslint-disable-next-line no-console
  (level === "error" ? console.error : level === "warn" ? console.warn : console.log)(line);
}

export const logger = {
  debug: (msg: string, fields?: Record<string, unknown>) => emit("debug", msg, fields),
  info: (msg: string, fields?: Record<string, unknown>) => emit("info", msg, fields),
  warn: (msg: string, fields?: Record<string, unknown>) => emit("warn", msg, fields),
  error: (msg: string, fields?: Record<string, unknown>) => emit("error", msg, fields),
  /** Child logger that prefixes every line with fixed fields (e.g. executionId). */
  child(base: Record<string, unknown>) {
    return {
      debug: (m: string, f?: Record<string, unknown>) => emit("debug", m, { ...base, ...f }),
      info: (m: string, f?: Record<string, unknown>) => emit("info", m, { ...base, ...f }),
      warn: (m: string, f?: Record<string, unknown>) => emit("warn", m, { ...base, ...f }),
      error: (m: string, f?: Record<string, unknown>) => emit("error", m, { ...base, ...f }),
    };
  },
};
