# Workflows

Diamond Edge orchestrates analysis with a small internal **graph workflow engine**
(`src/workflows/graph`). See `docs/architecture/GRAPH_WORKFLOWS.md` for the engine
guarantees and `docs/architecture/ADR/0001-internal-graph-engine.md` for why it is
internal rather than a heavy dependency.

## Writing a node

```ts
import { defineNode } from "@/workflows/graph/node";
import { ok, err } from "@/workflows/graph/result";

export const myNode = defineNode({
  id: "myNode",
  description: "what it does",
  inputSchema,          // Zod — validated before run
  outputSchema,         // Zod — validated after run
  dependsOn: ["upstream"],
  timeoutMs: 8000,
  retry: { maxAttempts: 3, backoffMs: 200, factor: 2 },
  failurePolicy: "skip-with-warning", // fail-fast | retry | skip-with-warning | fallback | degrade | escalate
  costCategory: "external-api",       // cpu | io | simulation | external-api
  selectInput: (inputs) => ({ ... }), // assemble typed input from upstream outputs
  run: async (input, ctx) => ok(result),
  fallback: () => ok(neutral),        // for fallback/degrade
  guard: (inputs) => true,            // conditional routing
});
```

Run it:

```ts
import { runWorkflow } from "@/workflows/graph/executor";
const { result, trace } = await runWorkflow(workflow, { initialInputs: { input } });
// result: Result<T> (errors are values); trace: WorkflowTrace
```

## Implemented — player prop

`src/workflows/player-prop`. Chain:

```
loadSeries → sampleQuality → project → simulate → priceCompare → verify → recommend
```

- Reuses the pure core (`project`, `simulate`, odds math) unchanged.
- Data adapter injected (`mlbSeriesAdapter`, server-only) so the workflow is
  offline-testable with fixtures.
- Terminal statuses: `ok`, `no-price` (model probability, no EV), `degraded`,
  `insufficient-data` (clean stop), `rejected` (verification failed).
- Exposed opt-in: `GET /api/players/[id]/analysis?engine=graph` → shared response
  envelope `{ data:{ recommendation, trace }, meta, error }`. The default route
  behavior is unchanged.

Run: `pnpm test:workflows`.

## Recommended next workflows (documented, not yet migrated)

- **Daily slate**: schedule → normalize → parallel game analysis → aggregate →
  rank → persist.
- **Game analysis**: metadata → parallel (pitchers, offense, bullpen, park,
  weather, lineup/injury) → deterministic merge → market analysis → verify → gate.
- **Backtest**: date range → point-in-time load → predict → match outcomes →
  metrics → report (time-aware; no leakage).
- **Revalidation**: new lineup/pitcher/weather/market → detect impacted
  predictions → recompute only affected nodes → compare versions → publish.

Each reuses this engine and the same node contract.
