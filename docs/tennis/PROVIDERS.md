# Tennis Data Providers

How Diamond Edge sources tennis data, what each provider does, and what it takes
to activate the credentialed ones. This reflects the code in
`src/lib/tennis/providers/` exactly — nothing here is aspirational.

## Design

All providers implement `TennisDataProvider` (`providers/types.ts`) and return
**normalized domain models** (`../domain`), never raw upstream shapes. The
`TennisProviderRegistry` tries providers in priority order and returns the first
routable, non-empty result (failover), and can `selectionFor(capability)` to
explain, in priority order, which providers are eligible and why.

### Truthful status lifecycle

A key existing in `process.env` is **never** enough for `ready`. A live provider
only reaches `ready` after a live call **authenticated + validated its schema +
mapped to the canonical domain + passed independent verification**
(`providers/verify.ts`).

| status | meaning | routable? |
|---|---|---|
| `ready` | Verified live call succeeded. | yes |
| `configured_unverified` | Key present; no verified call yet (may earn `ready`). | yes |
| `degraded` | Mapped but failed verification, or a transient error. | yes |
| `rate_limited` | Hit an upstream quota / `Retry-After`; backing off. | no |
| `entitlement_missing` | Key valid, but the account tier forbids the resource (403). | no |
| `unconfigured` | Requires credentials that are absent — **inert by design**. | no |
| `disabled` | Explicitly turned off. | no |
| `error` | Auth rejected (401), schema mismatch, or other failure. | no |
| `fixture` | Serves labeled test fixtures only — **never a production source**. | only when allowed |

Per-capability runtime status (`capabilityStatus()`) is `verified` / `supported`
/ `entitlement_missing` / `unsupported`, shown on the Data Health surface.

### Shared operational infrastructure

`providers/http.ts` is the single network seam: timeout, bounded retry with
full-jitter backoff, `Retry-After` honoring (capped), rate-limit parsing, a typed
error taxonomy, and **secret-safe** URL/header sanitization (an API key never
reaches a log line). `credentialedProvider.ts` wraps a provider-specific
`LiveAdapter` (`providers/adapters/*`) with credential gating, runtime Zod
validation, canonical mapping, independent verification, provenance, and health.

### Live provider capability matrix

Live verification of every provider is **BLOCKED_CREDENTIAL** in this environment
(no vendor keys). Each capability below is *contract-tested* — the adapter is
built from the official documented schema and exercised by committed sanitized
fixtures (`providers/adapters/fixtures.ts`) plus malformed/missing-field
rejection tests — but is **not** live-verified and no provider is marked `ready`.

| Provider | Auth | Schedule | Results | Rankings | Players | Historical |
|----------|------|----------|---------|----------|---------|------------|
| Sportradar   | BLOCKED_CREDENTIAL | wired | season-URN¹ | wired | wired | season-URN¹ |
| SportsDataIO | BLOCKED_CREDENTIAL | wired | wired | pending² | wired | UNSUPPORTED |
| API-Tennis   | BLOCKED_CREDENTIAL | wired | wired | wired | wired | UNSUPPORTED |

¹ Sportradar season results/historical need a season URN (`sr:season:…`) that is
not derivable from a bare year without an extra `/seasons` lookup; not wired for
the season query shape rather than fabricated.
² SportsDataIO's rankings endpoint/field names could not be verified without a
portal account; left unwired rather than inventing an endpoint.

### Documented mapping limitations (honest, not worked around)

- **Surface** is a tournament/venue property. When an endpoint omits it
  (API-Tennis fixtures), it is resolved via a **factual** tournament table
  (`resolveSurfaceFromTournament`); unresolved tournaments default to `hard` with
  an auditable `surface:unresolved` marker in the match's `sources`, which the
  verifier flags. Providers that supply surface (Sportradar conditions,
  SportsDataIO `Surface`) never carry the marker.
- **Best-of / round / environment** absent in a lean payload use documented
  neutral defaults (WTA ⇒ `best_of_3` by rule; environment `unknown`).
- **SportsDataIO field names** follow the public v3/tennis data dictionary and are
  accepted defensively (known variant spellings) — re-confirm against a live
  payload and capture a fresh fixture when a credential is available.

## Providers

### Fixture (`fixtureProvider`) — status: `fixture`
Test-only sample corpus (`fixtures/sample.ts`). Exercises the full
acquisition → validation → derivation pipeline without any credentials. The
registry **excludes** it from production paths unless `allowFixtures: true`
(tests/dev only).

### Historical CSV (`createHistoricalCsvProvider`) — status: `ready` with a corpus
Parses the widely-used **tennis-abstract** match CSV schema (Jeff Sackmann
format: one row per completed match, winner/loser oriented) into normalized
`TennisMatch` records. **No credentials required.** Real, verifiable capability
used for backtesting and priors.

- Required columns: `winner_name`, `loser_name`, `score`. Optional:
  `tourney_id`, `tourney_name`, `surface`, `tourney_date` (YYYYMMDD), `best_of`,
  `round`, `winner_id`/`loser_id`, `winner_rank`/`loser_rank`, `w_ace`/`w_df`/
  `l_ace`/`l_df`.
- Security: every free-text cell is checked against CSV **formula injection**
  (`= + - @` / leading whitespace) and rejected; malformed rows are skipped and
  counted, never crashing the parse.

### Manual (`createManualProvider`) — status: `ready` with data
Human-entered matches/players (mirrors the PrizePicks manual-import discipline).
No automation, no scraping. Values keep their manual provenance and are never
presented as a live feed.

### Credentialed live providers — status: `unconfigured` until keyed + verified
Each wraps a provider-specific `LiveAdapter` (real documented endpoints, auth,
raw Zod schemas, canonical mapping) in `createCredentialedProvider`. Inert
without a server-side API key; even with a key they start `configured_unverified`
and only reach `ready` after a verified live call. They never fabricate data.

| Provider | Env var | Base URL (docs) | Auth |
|---|---|---|---|
| `sportradarProvider` | `SPORTRADAR_TENNIS_API_KEY` | `api.sportradar.com/tennis/{access}/v3/{lang}` | `api_key` query param |
| `sportsDataIoProvider` | `SPORTSDATAIO_TENNIS_API_KEY` | `api.sportsdata.io/v3/tennis` | `Ocp-Apim-Subscription-Key` header |
| `apiTennisProvider` | `API_TENNIS_API_KEY` | `api.api-tennis.com/tennis/` | `APIkey` query param |

**Activation (per provider):**
1. Obtain a license/key from the vendor; set the env var **server-side only**.
2. The adapter already implements URL/auth/schema/mapping. On the first live
   call it authenticates, validates the response, maps to the domain, and runs
   independent verification; on success `status()` becomes `ready` on its own.
3. Capture a fresh sanitized fixture from the live payload and diff it against
   `providers/adapters/fixtures.ts` (confirms the documented schema still holds).

## Compliance invariants (enforced in code)
No account automation/login/credential storage · no CAPTCHA/anti-bot bypass · no
scraping protected pages · no fabricated/mock data in production paths · every
unavailable metric returns an explicit *unavailable* status · never join players
by name alone (`data/identity.ts`) · provider keys server-side only · CSV rejects
formula-injection · unverified providers are never called production-verified.

## Graph acquisition workflow (`tennis-data-acquisition@1`)

Provider acquisition runs on the existing internal graph engine
(`src/workflows/tennis-acquisition/`), not a new orchestrator:

```
providerHealth → selectProviders → [fan-out: fetch:<provider> per source]
    → reconcile (fan-in) → independentVerify → finalResult
```

- Every `fetch:<provider>` branch always returns `ok` (with its own success
  flag) so a failing/entitlement-blocked/non-selected branch **degrades** the
  workflow instead of cascade-skipping the fan-in.
- `reconcile` clusters the same real-world match across providers by a canonical
  key (normalized players + date) and surfaces **field-level discrepancies**
  (start time, state, surface, winner) — it never majority-votes a value.
- `independentVerify` re-derives invariants (`providers/verify.ts`); **rejected
  rows never reach the output**. When nothing verified survives, the result is
  `DATA_UNAVAILABLE` (fixtures are never silently presented as live data).
- The full `WorkflowTrace` records every executed node, api-call counts, and
  warnings; secrets never appear in the trace (the HTTP client sanitizes first).
