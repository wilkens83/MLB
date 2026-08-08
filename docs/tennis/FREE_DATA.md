# Free Tennis Data Mode

Diamond Edge's Tennis section is fully usable with **no paid API**. Data comes
from three free paths — all on the existing provider layer, graph engine,
verification, and quantitative model (nothing recreated). Paid providers
(Sportradar / SportsDataIO / API-Tennis) remain **optional** future live sources.

## Data modes

The UI always shows the active **Data Mode** and never displays `LIVE` unless a
credentialed provider was actually verified live (`src/lib/tennis/data/mode.ts`).

| mode | meaning | wired via |
|---|---|---|
| `LIVE` | Verified credentialed live provider. | live adapters (optional) |
| `FREE_CURRENT` | Permitted no-cost *current* source. | not wired (none permitted) |
| `HISTORICAL` | Free historical dataset. | `historical-free` provider |
| `MANUAL` | User-entered current matchup. | `manual` provider |
| `FIXTURE` | Deterministic demo fixtures. | `fixture` provider (DEMO DATA) |

## Free historical source

**Jeff Sackmann `tennis_atp` / `tennis_wta`** (the canonical free tennis dataset),
in the tennis-abstract schema. A **curated real sample** is bundled
(`src/lib/tennis/data/datasets/seed.ts`) so the whole pipeline runs offline and
deterministically at build/test time; the full corpus can be imported via the
`tennis-free-data-acquisition@1` graph workflow (the source loader is the
download/cache seam).

### License — surfaced, never concealed

The Sackmann match/ranking data is published under **CC BY-NC-SA 4.0**
(`licenseUse: "research/non-commercial"`, `datasets/manifest.ts`). It is for
research / development and **cannot silently become a commercial production
feed** — the Data Health UI states this explicitly.

### Provenance / versioning

Every dataset records `source`, `sourceRepository`, `datasetVersion`,
`sourceRef`, `coverageStart/End`, `tours`, `license`, `licenseUse`, per-file
`fileHashes`, and `parserVersion`.

### Coverage (bundled sample, computed)

ATP players 6 · WTA players 7 · ATP matches 7 · WTA matches 5 · ranking
observations 12 · matches with serve stats 11 · without 1 · years 2023–2024.
Missing fields (e.g. blank ranking points, missing serve stats) stay `undefined`
— never coerced to zero — and lower Data Quality honestly.

## `tennis-free-data-acquisition@1`

```
datasetMetadata → loadSource → normalize → resolveIdentities
  → verifyCanonicalData → persist → healthReport
```

Reuses `parseHistoricalCsv` (matches) + small players/rankings parsers,
`data/identity.ts` (never name-alone), `providers/verify.ts` (independent
invariants: player-vs-self, winner/score coherence, impossible scores,
duplicates, **future-ranking leakage**), and `data/observations.ts` (maps to the
existing `raw_observations` contract, `sport=tennis` via `entity_type` — no
schema change). Rejected data is never persisted; a future ranking past the
feature cutoff is REJECTED as leakage.

## Point-in-time

`freeRankingsAsOf(tour, asOf)` returns only observations knowable at/before the
cutoff — a player's future ranking is never used for an earlier match.

## Identity

Player ids are `csv:<sackmann_id>`, linking match sides to player bios and
rankings. Match ids are namespaced by tour (`atp:` / `wta:`) so combining tours
never collides. Ambiguous identities stay unresolved (never name-alone merges).
