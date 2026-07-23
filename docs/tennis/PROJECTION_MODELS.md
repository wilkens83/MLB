# Tennis Projection & Assessment Models

Covers feature engineering (Phase 6), the Elo rating engine (Phase 7), the market
models (Phase 9), and the probability / confidence / data-quality / recommendation
layer (Phase 10). Reflects `src/lib/tennis/model/` exactly.

## Feature engineering (`features.ts`)

`TennisFeatureBuilder` turns a player's normalized match history into serve /
return / context features. Design rules, all enforced:

- Operates only on normalized domain objects.
- **Every feature returns `{ value, sampleSize, source, freshness, missingReason? }`.**
  Missing data is never collapsed to 0 — `value` is `null` with a reason.
- **No future data**: only matches strictly before `context.asOf` are considered.
- Exposes **both** raw observed metrics and Bayesian-shrunk, model-ready metrics.
- Recency weighting is available (`recencyWeighted`) without destroying the raw
  windows.

### Windows

`l5`, `l10`, `l20`, `season`, `r52` (rolling 52 weeks), `same_surface`,
`same_environment`, `same_tour_level`, `similar_opponent` (opponent-strength
bucket by rank).

### Serve features
aces / DF per service game; aces per service point and DF per second serve
(estimated from `pointsPerServiceGame`, flagged in `source`); first-serve % and
first/second-serve points won %; **service points won %** (derived from the serve
split); hold %; break points faced per service game; break points saved %; average
service games per match.

### Return features
break % (return games won / return games), opponent hold suppression, average
return games per match. Point-level return metrics (return points won %, break
points created) are **honestly reported missing** — they are not in the normalized
stat line, so they return `null` + reason rather than a fabricated proxy.

### Context features
surface, indoor/outdoor, tour level, round, best-of, days rest, matches in last
7/14 days, ranking + ranking change, overall/surface/opponent Elo, projected
competitiveness, retirement history, recent walkovers, and data completeness.
Unavailable context (e.g. minutes played — not in normalized data) is flagged
missing.

### Shrinkage
`shrink(fv, prior, k)` applies `(n·obs + k·prior)/(n+k)`. `modelServeRates` /
`modelReturnRates` return shrunk, simulator-ready rates (never null — they fall
back to the configured prior when data is absent, and flag that in `source`). Raw
values remain separately available for explainability and data-quality scoring.

## Rating engine (`rating.ts`)

Self-contained Elo — **overall** plus a **per-surface** ladder (hard/clay/grass/
carpet). Chronological replay with inactivity decay; walkovers never update
ratings; retirements are configurable (`normal` / `half_k` / `skip`). No RNG —
deterministic. **No temporal leakage**: `getPlayerRatingBefore(playerId, date,
surface)` returns the rating that existed strictly before `date`; the engine is
tested to never use a match's own (or any later) result to rate it.

`getMatchWinProbability` blends overall + surface Elo; `getSetWinProbability`
compresses the match probability toward 0.5 (a set is a smaller sample).

## Market models (`markets.ts`)

`projectMarket({ player, opponent, matchContext, line, market, seed, iterations })`
builds a `TennisMatchModel` (features → serve-point model → simulator), runs the
simulation, and reads the market straight off the samples. `projectMarkets`
projects many markets from **one** batch. Core markets, all simulator-derived:

| Market | Sample source |
|---|---|
| `aces` | simulated aces (from service opportunities) |
| `double_faults` | simulated DFs (from service opportunities) |
| `total_games` | simulated scorelines |
| `games_won` | simulated scorelines (subject side) |
| `total_sets` | simulated match length |
| `sets_won` | simulated set outcomes |
| `tie_breaks` | actual simulated tiebreak events |

Each projection returns mean/median/SD, full quantiles, `probabilityMore/Less/
Push`, a **fair line** with ±0.5 sensitivity, volatility (CV), the feature snapshot
id, and the model version.

### Fair line (`fairline.ts`)
Derived from the simulated distribution: median & mean fair line, nearest
actionable half-line, `P(more)` at the current line, and `P(more)` at ±0.5 — the
sensitivity future line-movement logic needs.

## Assessment (`assessment.ts`) — three separate questions

- **Probability** — how often the simulation beats the line.
- **Confidence** — how much to trust the estimate: sample size, surface sample,
  recency, input completeness, provider quality, identity-resolution confidence,
  Elo stability, calibration, prediction variance.
- **Data quality** — input completeness, freshness, provider health, mapping
  quality, historical depth, provider conflicts, missing serve/return data.

These are computed as **distinct** 0–100 scores.

### Recommendation
`STRONG_MORE | LEAN_MORE | NO_EDGE | LEAN_LESS | STRONG_LESS | AVOID_LOW_DATA |
AVOID_HIGH_VOLATILITY | UNAVAILABLE`.

A recommendation requires **both** a sufficient probability edge **and** minimum
confidence + data-quality (all thresholds in `config.thresholds`). A high
probability on thin or low-quality data can **never** become STRONG — it degrades
to `NO_EDGE` or `AVOID_LOW_DATA` (tested).

### Explainability
Every assessment includes structured `reasons` (`{ factor, direction, magnitude,
explanation }`) tied to **actual feature values** (serve dominance vs surface
baseline, ace rate vs tour baseline with the surface multiplier, opponent return
strength, Elo edge, mutual serve strength) plus explicit `warnings` (thin
same-surface sample, incomplete serve/return data, unknown indoor/outdoor, high
volatility, default Elo).

## Provenance (`version.ts`)

Every projection and assessment carries a `TennisModelVersion`
(`model / feature / simulator / rating / scoringRulesVersion / configChecksum`).
The checksum is a canonical (recursively key-sorted) hash of the config, so a
result is reproducible from a pinned code + config state — not merely from
"latest".
