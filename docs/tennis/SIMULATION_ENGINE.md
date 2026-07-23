# Tennis Simulation Engine

How Diamond Edge turns two players + a match context into probabilistic prop
projections. This documents the **structural** simulator (Phase 8) and the
serve-point model that drives it. It reflects the code in
`src/lib/tennis/model/` exactly.

## Why structural, not distributional

Tennis totals (games, sets, tiebreaks, aces) are **not** independent normal
quantities — they emerge from the same underlying process: who wins each service
point. Modeling them separately with fitted normals loses the correlations that
matter (a big-serving pair produces more games *and* more tiebreaks *and* more
aces together). So the engine simulates the real scoring tree:

```
service-point probability  →  point  →  game  →  tiebreak  →  set  →  match  →  prop outcomes
```

Every market in Phase 9 is read straight off these simulated matches. There is no
parallel closed-form model for a quantity the simulator already produces.

## The serve-point model (`servePoint.ts`)

The single quantity that parameterizes everything is **P(server wins a service
point)** for each of the two serving directions (A-serving-vs-B, B-serving-vs-A).
It is a documented **logit-space blend** — no unexplained magic numbers; every
weight lives in `config.servePoint`:

```
logit(p) = base     · logit(baselineServe_surface)
         + server   · ( logit(serverServeStrength)   − logit(baselineServe) )
         + returner · ( logit(baselineReturn)        − logit(returnerReturnStrength) )
         + elo      · ( (serverElo − returnerElo) / eloScale )
         + contextAdjust
p = clamp( sigmoid(logit(p)), minP, maxP )
```

- `serverServeStrength` = server's service-points-won% (Bayesian-shrunk).
- `returnerReturnStrength` = returner's return-points-won% (shrunk). A strong
  returner (above the baseline a server usually concedes) **lowers** `p`.
- `baselineServe_surface` comes from `config.surfaceServeBaseline` (hard ≈ 0.645,
  clay ≈ 0.632, grass ≈ 0.66).
- The result is clamped to `[minP, maxP]` = `[0.50, 0.86]` — realistic tennis
  serve-point bounds.

**Aces & double faults** are drawn per service point (`aceDfProbabilities`), from
the player's per-service-game rates converted to per-point via
`pointsPerServiceGame`, scaled by a surface multiplier and modestly suppressed by
a strong-returning opponent. Because they are drawn on every service point, ace
and DF totals **scale with match length** — never modeled independently of games.

To keep the overall serve-point probability consistent with the ace/DF layer, a
normal (non-ace, non-DF) point resolves with
`pNormal = (pServe − aceProb) / (1 − aceProb − dfProb)`, so
`P(ace)·1 + P(df)·0 + P(normal)·pNormal = pServe` exactly.

## Scoring (`simulator.ts`)

- **Game** — first to 4 points, win by 2 (deuce/advantage), with a safety cap on
  pathological deuce loops.
- **Tiebreak** — first to `tiebreakPoints`, win by 2, with **correct service
  rotation**: the starter serves point 1, then service alternates every 2 points.
- **Set** — games alternate server; at `tiebreakAt`-all a tiebreak decides the
  set (when the set uses one), otherwise it is an advantage set (win by 2).
- **Match** — best-of-3 or best-of-5; service rotation carries continuously across
  games and sets; the deciding set applies the configurable final-set rules.

### Configurable scoring rules (`TennisScoringRules`)

```
{ bestOf, gamesPerSet, tiebreakAt, tiebreakPoints, finalSetTiebreak, finalSetTiebreakPoints }
```

Not all tournaments share final-set behavior — a deciding set can be a 7-point
tiebreak, a 10-point tiebreak, or a no-tiebreak advantage set. All are supported
and tested (6-0, 6-4, 7-5, 7-6, and an 8-6 advantage set).

## Determinism & batching

- Uses the shared seeded RNG (`mulberry32` + `seedFromString`). **Same seed ⇒
  identical result.** No hidden global RNG state — the `rng` is threaded
  explicitly through every function.
- `simulateMatches(sides, rules, { iterations, seed })` runs a batch (default
  10 000; tests use smaller deterministic counts) and returns per-iteration sample
  arrays for every market at once — the expensive step (simulation) is shared.
- Each simulated match captures: winner, per-set scores, total sets/games, games
  won per player, service/return games, tiebreaks played + won, service/return
  points, and aces/double faults per player.

`buildDistribution(samples)` summarizes any sample array into
`{ mean, median, standardDeviation, p10, p25, p50, p75, p90, minimum, maximum, sampleCount }`.

## Validated behavior (see `model.test.ts`)

- Deterministic seeded output; More/Less/Push partition to 1.
- Serve-point probabilities stay within realistic bounds under extreme inputs.
- Best-of-5 produces more service opportunities than best-of-3.
- Higher ace rate raises the ace distribution.
- Higher hold rates raise tiebreak frequency.
- A stronger server wins more matches, and the effect grows monotonically with the
  gap.
- Sanity scenarios A–E (elite server vs weak returner; elite returner vs weak
  server; two big servers; large mismatch; same player on hard vs clay) all match
  expectations.
