# Risk Register — Audit (Phase 1)

Likelihood (L) × Impact (I), each 1–5. Ordered by L×I.

| ID | Risk | L | I | Score | Mitigation | Owner phase |
| --- | --- | --- | --- | --- | --- | --- |
| R1 | Uncalibrated probabilities presented as trustworthy → users over-trust model. | 4 | 5 | 20 | Verification node bounds all probs; EVALUATION_STRATEGY ties recommendations to backtest calibration; UI must label "research, not a guarantee". | Statistical / eval |
| R2 | One optional context source failing throws away the whole analysis. | 4 | 4 | 16 | Node failure policies (skip-with-warning / degrade / fail-fast per source). | Workflow |
| R3 | Data leakage in backtests (future data predicting past). | 3 | 5 | 15 | Point-in-time `available_at <= feature_cutoff` (already enforced in persistence); leakage test in the statistical suite; verification `FreshnessVerifier`. | Eval / tests |
| R4 | Invalid numeric outputs (NaN/Inf/out-of-range) reach the client. | 3 | 4 | 12 | `ProbabilityBoundsVerifier` + `ProjectionSanityVerifier` + Zod refinements at the boundary. | Verification |
| R5 | External API outage blocks unrelated features. | 3 | 4 | 12 | Retry-with-backoff + timeout per node; explicit degraded result; live-data tests kept off the PR gate. | Workflow / CI |
| R6 | Stale lineup / missing probable pitcher silently used. | 3 | 4 | 12 | `FreshnessVerifier` + pitcher-market rejection policy; `lineupConfirmed`/`starterConfirmed` already surfaced. | Verification |
| R7 | Stack traces / internal messages leaked in error responses. | 3 | 3 | 9 | Shared response envelope; no `err.message` to clients. | API |
| R8 | Race conditions from duplicate concurrent upstream requests. | 2 | 4 | 8 | Request dedup exists in `mlb/client.ts`; bounded concurrency in the executor. | Performance |
| R9 | Latent circular deps as graph + observability layers land. | 3 | 2 | 6 | Strict import rule: graph/schemas import nothing from adapters/UI. | Architecture |
| R10 | Monte Carlo on the request path → latency spikes under load. | 2 | 3 | 6 | Deterministic seed enables safe result caching; budget caps work; documented. | Performance |
| R11 | Global caching of user-specific market prices. | 2 | 4 | 8 | Prices are request inputs, never cached globally; documented rule. | Performance / security |
| R12 | Test suite depends on live MLB availability. | 2 | 3 | 6 | Fixtures for external responses; unit/contract/workflow suites offline. | Tests |

## Accepted / out-of-scope for this migration (documented, not fixed now)

- Full `src/lib → src/core|src/data` physical move (done incrementally later; the
  target tree is documented and the pure boundary already exists logically).
- Full frontend feature-folder restructuring and chart a11y summaries.
- Wiring live calibration metrics into the UI (backtest engine exists; surfacing
  is a follow-on).
