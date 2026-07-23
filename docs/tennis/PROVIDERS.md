# Tennis Data Providers

How Diamond Edge sources tennis data, what each provider does, and what it takes
to activate the credentialed ones. This reflects the code in
`src/lib/tennis/providers/` exactly — nothing here is aspirational.

## Design

All providers implement `TennisDataProvider` (`providers/types.ts`) and return
**normalized domain models** (`../domain`), never raw upstream shapes. The
`TennisProviderRegistry` tries providers in priority order and returns the first
ready, non-empty result (failover). Each provider reports a `status()`:

| status | meaning |
|---|---|
| `ready` | Credentials present (or none needed) and able to serve. |
| `unconfigured` | Requires credentials that are absent — **inert by design**. |
| `fixture` | Serves labeled test fixtures only — **never a production source**. |
| `error` | Configured but failing (or mapping unverified). |

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

### Credentialed live providers — status: `unconfigured` until keyed
Inert without a server-side API key **and** a verified upstream mapping. They
never fabricate data and are never described as production-verified until a real
integration test confirms the mapping in an environment that has credentials.

| Provider | Env var | Base URL (docs) | Notes |
|---|---|---|---|
| `sportradarProvider` | `SPORTRADAR_TENNIS_API_KEY` | `api.sportradar.com/tennis/.../v3` | Commercial license. Schedules, results, rankings, profiles, historical. |
| `sportsDataIoProvider` | `SPORTSDATAIO_TENNIS_API_KEY` | `api.sportsdata.io/v3/tennis` | Commercial. `Ocp-Apim-Subscription-Key` header. |
| `apiTennisProvider` | `API_TENNIS_API_KEY` | `api.api-tennis.com/tennis` | Freemium, rate-limited. Key as query param. |

**Activation checklist (per provider):**
1. Obtain a license/key from the vendor.
2. Set the env var **server-side only** (never in the browser bundle).
3. Implement + verify the upstream→domain mapping against the live API with an
   integration test.
4. Only then flip its `status()` path to `ready` — do not mark verified before.

## Compliance invariants (enforced in code)
No account automation/login/credential storage · no CAPTCHA/anti-bot bypass · no
scraping protected pages · no fabricated/mock data in production paths · every
unavailable metric returns an explicit *unavailable* status · never join players
by name alone (`data/identity.ts`) · provider keys server-side only · CSV rejects
formula-injection · unverified providers are never called production-verified.
