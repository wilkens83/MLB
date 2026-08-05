# ADR 0001 — A small internal graph engine (no external workflow library)

- **Status:** Accepted
- **Date:** 2026-08
- **Context:** Orchestration (`runAnalysis`) is a monolithic async function with no
  typed step boundaries, per-step timeout/retry/failure policy, trace, or
  partial-failure semantics. We need a workflow engine to add these.

## Decision

Build a **small, typed, Zod-bounded internal graph engine** in
`src/workflows/graph` rather than adopting a large external workflow dependency.

## Rationale

- The audit found **no** existing workflow dependency and no requirement that
  justifies one. Our needs (typed nodes, dependency ordering, bounded fan-out,
  retry/timeout, budget, cancellation, trace, typed `Result`) are a few hundred
  lines and must run under Bun and in a Node route with zero new runtime deps.
- Zod is already a dependency, so contracts and node schemas cost nothing extra.
- The pure analytics core must stay dependency-free; a heavyweight engine would
  risk pulling framework concerns toward the core.
- An internal engine lets us enforce our exact import rules (engine imports nothing
  from adapters/UI) and our exact error/trace shapes.

## Consequences

- We own and test the executor (ordering, retry, timeout, budget, cancellation).
- Nodes are portable and unit-testable in isolation.
- If future needs outgrow the engine (durable execution, distributed scheduling),
  this ADR is revisited; the node contract is designed to be adapter-friendly.

## Alternatives considered

- **A large workflow/orchestration library**: rejected — unjustified weight and new
  runtime dependency for needs met by ~a few hundred lines.
- **Keep imperative `Promise.all` orchestration**: rejected — no typed boundaries,
  no per-step policy, no trace, poor partial-failure behavior.
