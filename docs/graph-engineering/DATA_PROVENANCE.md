# Data Provenance

Every forecast must be reproducible from its recorded provenance — not merely
`sourceAvailable = true`.

## Recorded today
- `modelVersion` (engine), `MODEL_ENSEMBLE_VERSION`, `BASELINE_MODEL_VERSION`,
  calibration version (or `none`), feature version.
- Seeded RNG key (`playerId:propKey:line`) → reproducible Monte Carlo.
- Provider source availability + Statcast `fetchedAt`; park factors; data timestamps
  (`dataAsOf`), season.
- Market snapshot is kept SEPARATE from the projection: a PrizePicks/sportsbook line
  is only a threshold for `P(X>line)` / `P(X<line)` and never modifies the projection.

## Reproducibility invariant
The same input snapshot + model version + seed reproduces the same simulation result
(tested). Missing values stay `undefined` and are reported unavailable — never
coerced to 0, never fabricated.

## Pending
Persisting the full per-forecast provenance bundle (weather/lineup timestamps,
market snapshot time) into the immutable snapshot row alongside model outputs, so a
historical forecast can be replayed exactly.
