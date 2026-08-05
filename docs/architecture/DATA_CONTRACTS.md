# Data Contracts

All external data and every workflow boundary is validated at runtime with Zod.
**A TypeScript type is not a guarantee** — parse, don't assume.

## Where validation happens

1. **Request boundary** — route handlers parse query/body with a request schema.
2. **Adapter boundary** — raw MLB/Savant responses are mapped, then the mapped
   domain object is parsed by its schema before entering a workflow.
3. **Node boundary** — the executor parses each node's input against
   `inputSchema` and its output against `outputSchema`. A parse failure is a
   `ValidationError` Result, never a thrown exception across the boundary.
4. **Response boundary** — the workflow result is wrapped in the shared envelope.

## Contract catalog (`src/schemas`)

| Schema | Shape (key fields) |
| --- | --- |
| `Game` | gamePk, date, home/away team, status, startTime |
| `Team` | id, abbr, name |
| `Player` | id (MLBAM), name, position, isPitcher, bats, throws |
| `Pitcher` | player + hand, role (starter/opener/bulk) |
| `Lineup` | gamePk, team, confirmed, slots[] |
| `WeatherContext` | tempF?, windMph?, condition?, available |
| `ParkContext` | venue, factor multipliers |
| `Market` / `PropDefinition` | key, family (poisson/negbinom/bernoulli/normal), category |
| `MarketPrice` | american over/under? (user-supplied; never invented) |
| `Projection` | mean/lambda, method, sampleSize, featureCutoff |
| `SimulationResult` | pOver, pUnder, pPush, mean, stdDev, iterations, ci |
| `ProbabilityEstimate` | side, probability ∈ [0,1], method |
| `Recommendation` | side, probability, edge?, ev?, confidence, status |
| `VerificationResult` | passed, checks[]{name, passed, detail}, rejections[] |
| `WorkflowTrace` | executionId, nodes[], warnings, status |
| `PredictionVersion` | version, inputHash, generatedAt, supersedesId? |
| `BacktestResult` | brier, logLoss, calibration[], n, byMarket[] |

## Invariants enforced by refinements

- probabilities ∈ [0,1] and finite; `pOver + pUnder + pPush` ≈ 1 (± tolerance).
- sampleSize ≥ 0; iterations within `[MIN, MAX]` bounds.
- `featureCutoff <= eventStartTime` (no leakage).
- market family ∈ the prop catalog's declared set.
- recommendation `status` ∈ {ok, insufficient-data, degraded, no-price, rejected}.

Contracts are **additive**: they wrap/mirror the existing `lib/*/types` rather than
replacing them, so nothing downstream breaks during migration.
