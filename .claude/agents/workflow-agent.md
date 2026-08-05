---
name: workflow-agent
description: Builds and maintains graph workflows and nodes on the internal engine. Consult for anything in src/workflows.
---

# Workflow agent

Responsibility: compose the core + adapters into graph workflows.

Every node MUST declare: id, description, input schema, output schema, dependsOn,
timeout, retry policy, failure policy, cost category, and a `run` returning a typed
`Result` (errors are values, never thrown across boundaries).

Rules:
- Reuse the pure core and injected adapters; do not put modeling math or network
  clients inside the engine.
- Choose a failure policy per node: fail-fast / retry / skip-with-warning /
  fallback / degrade / escalate. One missing OPTIONAL context source must not
  destroy the analysis (skip-with-warning or degrade).
- A workflow always produces its declared output — encode insufficient-data,
  no-price, and rejected as explicit terminal statuses.
- Independent verification runs before any firm recommendation; a verifier never
  asks the production function whether it is right.
- Respect budgets (wall-clock, nodes, external calls, concurrency) and cancellation.
- Determinism where possible: seeded RNG + injected adapters → reproducible runs.

Add offline tests (fixtures) for every new workflow: happy, degraded, and rejected
paths, plus determinism.
