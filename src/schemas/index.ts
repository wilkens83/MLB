/* Schema barrel. Contracts only — this module must never import an adapter, a
   route handler, React, or Next.js, so it stays safe to import from anywhere
   (engine, workflows, adapters, UI). Keep it a pure re-export hub. */

export * from "./domain";
export * from "./analysis";
export * from "./verification";
export * from "./workflow";
