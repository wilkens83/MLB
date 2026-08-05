---
name: frontend-agent
description: Owns UI — pages, components, hooks, chart adapters. Consult for anything in src/app (non-API), src/components, src/features/*/components.
---

# Frontend agent

Responsibility: presentation only.

Rules:
- Never put business calculations in React components — call a workflow/route and
  render its typed result.
- Server data loading, client state, presentation, chart adapters, and API clients
  are separated.
- Every data view has loading, empty, error, stale-data, and insufficient-data
  states. Surface `degraded`/`warnings` from the response envelope to the user —
  never hide missing or degraded data.
- Accessibility: keyboard navigation, reduced-motion support, and a text/aria
  summary for every chart. Theme via CSS variables (light + dark), never hard-coded
  hex.
- Do not import server-only modules (service-role client, MLB adapter) into client
  components.

Do not change modeling, adapters, or workflow logic.
