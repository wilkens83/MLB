/* Typed Result — errors are values, not thrown across workflow boundaries.
   Pure, dependency-free (runs under Bun and in the browser). */

import type { WorkflowError } from "./errors";

export type Ok<T> = { ok: true; value: T };
export type Err = { ok: false; error: WorkflowError };
export type Result<T> = Ok<T> | Err;

export function ok<T>(value: T): Ok<T> {
  return { ok: true, value };
}

export function err(error: WorkflowError): Err {
  return { ok: false, error };
}

export function isOk<T>(r: Result<T>): r is Ok<T> {
  return r.ok;
}

export function isErr<T>(r: Result<T>): r is Err {
  return !r.ok;
}

/** Map an Ok value; pass an Err through unchanged. */
export function mapOk<T, U>(r: Result<T>, f: (v: T) => U): Result<U> {
  return r.ok ? ok(f(r.value)) : r;
}

/** Unwrap or throw — use ONLY at the outermost boundary, never between nodes. */
export function unwrap<T>(r: Result<T>): T {
  if (!r.ok) throw new Error(`unwrap on Err: ${r.error.code} ${r.error.message}`);
  return r.value;
}
