# AI Data Chat — architecture

A conversational analytics workspace (`/chat`) that answers natural-language
questions about the app's **real** data — MLB slate, projections, PrizePicks
edges, data health — through a **controlled, typed tool layer**. The model never
queries arbitrary modules, SQL, or shell; it can only reach data via the tool
allow-list, and it can never fabricate a number.

## Request flow

```
/chat (client)  ──POST──▶  /api/chat (route, Zod-validated, rate-limited)
                                   │
                                   ▼
                         orchestrator.runChat()
      ┌────────────────────────────┼───────────────────────────────┐
      │ resolve date/season/tz     │ build tool registry (allow-list)│
      │ load recent turns + state  │ guardrailed invoke()            │
      └────────────────────────────┼───────────────────────────────┘
                                   ▼
                    provider.respond()  (mock | anthropic)
                                   │  invoke(tool, input)
                                   ▼
                     controlled tools ──▶ existing MLB/PrizePicks services
                                   │       (runAnalysis, buildSlate, market…)
                                   ▼
                 response-builder → validated ChatResponseBlocks
                                   │
                                   ▼
       validate (Zod) + clamp rows → persist user+assistant → return
```

## Layers (`src/features/chat/`)

- **schemas/** — Zod for the request (`request.ts`, with `CHAT_LIMITS`),
  the response (`response.ts`), the block union (`blocks.ts` — markdown, table,
  player-card, game-card, metric-grid, bar/line chart), and source references +
  freshness (`sources.ts`). The response is validated before it leaves the
  server, so a malformed model/composer output never reaches the client, and no
  raw HTML is ever rendered.
- **tools/** — the controlled analytics layer. `ChatToolDefinition` (typed input
  schema + `execute`), a `ToolRegistry` allow-list, and MLB/PrizePicks tools that
  **reuse existing services** (`runAnalysis`, `buildSlate`, `computeMarketGameCards`,
  `searchPlayers`, `savantStatcastProvider`, `evaluateEntry`, provider health).
  Each tool returns structured data + its own `sources` + `warnings`.
- **llm/** — the provider abstraction (`ChatModelProvider`). `mock-provider`
  (default, offline, deterministic) classifies intent, invokes the same tools a
  real LLM would, and composes from real data. `anthropic-provider` is a real,
  env-gated adapter that is **hallucination-proof by construction**: the tools +
  deterministic builders produce every number/block/source; the model only
  rewrites the prose. `factory` selects by `CHAT_AI_PROVIDER`.
- **server/** — `orchestrator` (date/season resolution, guardrailed `invoke`,
  provider run, validation, persistence), `intent` (deterministic classifier),
  `response-builder` (pure block formatters), `conversation-store` (in-memory,
  session-keyed, shaped like the target DB tables), `date` (relative-date
  resolution), `session` (anonymous cookie id).
- **components/** — the terminal-style UI: workspace, conversation sidebar,
  message (blocks + sources + freshness + warnings + export + suggestions),
  composer, empty state, safe markdown (no raw HTML).
- **prompts/** — the system prompt encoding the data-safety contract.

## Guardrails (`CHAT_LIMITS`)

Message length, recent-history window, **max tools per request**, per-tool
timeout (AbortController), overall request timeout, **max table rows**, and a
per-session rate limit. All inputs are Zod-validated; failed/timed-out tools
degrade to an empty, warning-only result instead of crashing the answer.

## Data-safety contract

- Answers only from tool results — never invents players, games, lines,
  probabilities, or injuries. Unsupported domains (bullpen quality, injuries,
  weather, first-inning markets) are answered honestly as unavailable.
- Projections are labeled as estimates; **projected** lineups are distinguished
  from confirmed; **PrizePicks is imported (paste/CSV), never live** — the source
  and import time are always shown.
- Missing values stay unavailable (never coerced to 0). Every data-backed answer
  cites sources with freshness (live / fresh / stale / historical / unknown) and
  carries `generatedAt`, `dataAsOf`, and the model version.
- The season is resolved from the (resolved) date via `getCurrentMlbSeason`, so a
  historical date never leaks the current season.

## Providers

| `CHAT_AI_PROVIDER` | Behavior |
|---|---|
| `mock` (default) | Offline, deterministic. No API key. Verified path. |
| `anthropic` | Real adapter; needs `ANTHROPIC_API_KEY`. Prose-only LLM role; falls back to deterministic output without a key. |
| `openai` / `google` | Interface-ready; no adapter shipped — factory throws a clear error. |

See `.env.example`. Keys are read server-side only and never sent to the browser.

## Persistence

The default `ConversationStore` is in-memory and keyed by an anonymous session
cookie. Its interface and record shapes mirror the intended tables
(`chat_conversations`, `chat_messages`, `chat_tool_calls`, `chat_saved_queries`),
so a Postgres/Supabase adapter can drop in behind the same interface without
touching callers. `user_id` is already carried (as the session id) so
authenticated users are a drop-in later.

## Extending

- **New tool:** add a `ChatToolDefinition` under `tools/…`, register it in
  `tools/index.ts`, teach `intent.ts` (or the LLM) to select it, and add a
  builder in `response-builder.ts`.
- **New sport/domain:** tools declare a `domain` (`mlb` | `prizepicks` | `tennis`
  | `system`); `registry.forSport()` already filters by it, so a new domain is
  additive.

## Testing

Unit tests (offline, deterministic under `bun test src`) cover the registry,
input validation, date + intent classification, follow-up context, conversation
trimming, response/block validation, source citation + freshness, missing-data
and unsupported-question guardrails, provider factory, table-row clamping, rate
limiting, and the mock provider composed against **stubbed** tools (so no numbers
are fabricated). `scripts/shoot-chat.mjs` is a Playwright e2e smoke that drives a
real conversation against the dev server (opens `/chat`, asks a question, renders
a table, asks a follow-up; desktop + mobile) — kept out of the offline unit suite.
