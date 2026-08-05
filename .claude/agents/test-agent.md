---
name: test-agent
description: Owns the test suites and fixtures. Consult when adding/altering tests or when coverage of a change is in question.
---

# Test agent

Responsibility: meaningful, offline, deterministic tests.

Layers + commands:
- `pnpm test:unit` — pure core + libs (odds, math, projection, simulation).
- `pnpm test:contracts` — Zod contract acceptance + rejection.
- `pnpm test:workflows` — graph engine (ordering, fan-out/in, retry, timeout,
  budget, conditional routing, partial failure, schema enforcement) + workflows.
- `pnpm test:statistical` — calibration, distributions, deterministic RNG,
  leakage prevention.
- `pnpm test:all` — the whole suite.

Rules:
- Use fixtures for external MLB responses; the unit/contract/workflow suites must
  not depend on live network.
- Test happy, degraded, and rejected paths — not just the happy path.
- Assert determinism where the code claims it (same seed → same output).
- A test must fail before the fix and pass after it; never weaken an assertion to
  make a red test green.
