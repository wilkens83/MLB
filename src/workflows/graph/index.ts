/* Graph engine barrel. Engine only — imports nothing from adapters or UI, so it
   is safe to import from workflows, adapters, and route handlers alike. */

export * from "./result";
export * from "./errors";
export * from "./types";
export * from "./node";
export * from "./edge";
export * from "./executor";
export { TraceCollector } from "./trace";
