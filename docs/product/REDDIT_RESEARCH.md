# Reddit MLB News & Trend Intelligence

## Purpose

Reddit is an **early-warning / context source**, not a prediction engine. It helps
surface possible contextual signals around a player — a pitch-count limit, a
scratch, an injury, a velocity concern — *before* they show up in official feeds.

**Governing rule:** Reddit detects possible information → verification determines
credibility → structured `ContextEvent`s preserve it → **only** the deterministic
usage engine decides whether a *confirmed* event changes a projection. There is
**no** `Reddit sentiment → probability` path anywhere. (`src/lib/research/`.)

```
Player → Reddit search → raw items → spam filter + classify → cluster (dedup)
       → source credibility → verification → ContextEvents → surface in UI
```

## Search strategy

- Focused, context-term queries only — **never a bare name**. Each query quotes the
  player and pairs it with a term: injury, scratch, pitch count, pitch limit,
  velocity, command, walks, bullpen, opener, lineup, role, IL, return.
  (`queries.ts` · `generatePlayerQueries`.)
- Relevant communities: `r/baseball`, `r/fantasybaseball`, plus the player's and
  opponent's team subreddits when resolvable.
- The provider (`provider.ts`) uses Reddit's public search JSON with a descriptive
  User-Agent and bounded fan-out (≤6 queries). It is **disabled by default**:
  without `REDDIT_RESEARCH_ENABLED=1` it returns a clean `unavailable` state and
  **never fabricates posts**.

## Supported event types

`injury · scratch · pitch_limit · role_change · velocity_change · command_issue ·
lineup · opener · bullpen_game · fatigue · return_from_il · other`

Classification (`classify.ts`) is deterministic keyword matching, not sentiment.
Items matching no actionable pattern (memes, one-word reactions, bet slips,
fantasy-trade noise, bots) are dropped.

## De-duplication

The same rumor across many threads is **one** event with N supporting items.
Clustering (`dedupe.ts`) keys on `event type + normalized keyword bucket + 24h
window`; `uniqueThreads` counts distinct post ids so three comments in one thread
are not three facts.

## Source credibility

`low | medium | high` (`credibility.ts`), raised by: an external/official link
(mlb.com, ESPN, The Athletic, AP, …), a reporter/source reference, multiple
independent threads, relevant subreddits, and recency. A comment with no source
stays low.

## Verification rules

`verify.ts` checks a candidate against authoritative, deterministic facts and sets
status:

- `velocity_change` → **rejected** when Statcast velocity is stable; **reported**
  when Statcast shows a real decline.
- `scratch` → **rejected** when the player is in the confirmed lineup; **reported**
  when the confirmed lineup omits them.
- any type → **confirmed** when an explicit official confirmation is present.
- otherwise → **unverified** (never silently confirmed).

`confidence` (0..1) is a confidence in the *signal*, never a game probability.

## No-direct-probability rule (mandatory)

The model pipeline (`project → simulate → ensemble`) does **not import the research
layer at all**. The invariant test (`safety-invariant.test.ts`) proves: identical
numerical inputs give an identical probability regardless of Reddit sentiment. The
**only** bridge is `features.ts` (`contextEventsToFeatures`), which consumes
**confirmed events only** and emits explicit deterministic flags (pitch ceiling,
player-unavailable, opener, return-from-IL). Sentiment, trend, and unverified /
reported / rejected events produce **nothing** numerical.

## Snapshot integration

`PredictionSnapshot.contextEvents` stores the events **known at prediction time**.
`attachContextEvents(events, predictionTimestamp)` excludes any event with
`fetchedAt > predictionTimestamp` — future Reddit information can never leak into a
historical snapshot. Backtesting therefore never injects post-hoc rumors.

## Persistence & predictive-value evaluation

- **Storage.** `context_events` (Supabase migration `20260811000000`) is
  **append-only** and **point-in-time**: every fetch appends a capture; a DB
  trigger blocks UPDATE/DELETE, so the full history of how a signal evolved is
  preserved. RLS is service-role-write / authenticated-read.
  `SupabaseContextEventStore` sits behind the existing `ContextEventStore`
  interface; `getContextEventStore()` uses it when `SUPABASE_SERVICE_ROLE_KEY` is
  set, else the in-memory baseline. Reads collapse to the latest capture per
  `event_key`.
- **Evaluation gate.** `evaluateContextPredictiveValue(observations)`
  (`evaluate.ts`) measures whether an event type/status's *presence* correlates
  with an outcome — base rate vs event-present rate + lift + sample sizes. It is a
  **validation gate, never a feedback loop**: it does not touch a projection. It
  never returns "validated" (the strongest per-event verdict is `possible_signal`,
  and the report verdict is `insufficient_history` / `unvalidated`) — promoting a
  signal is a governance decision made from the report, not by architecture.

## Limitations

- **Predictive value is UNVALIDATED.** Until enough persisted point-in-time events
  accumulate, we do not claim Reddit improves Brier or win rate; the evaluation
  harness enforces this honestly.
- The provider is disabled by default; when enabled it is subject to Reddit rate
  limits (bounded, cached ~10 min per player).
- Verification currently uses Statcast velocity + confirmed-lineup facts; a live
  injury/transactions feed would strengthen `confirmed` coverage.
- Events are stored in-memory (swappable interface) — Supabase persistence is the
  next step for auditable history and backtesting.

## Surface

`GET /api/research/reddit/player/[playerId]` → `PlayerResearch`
(`{ status, events, sentiment, trend, note, lastUpdated }`; `unavailable` when off).
The Player Analyzer renders **News & Community Signals** *below* the model/decision
blocks (supporting intel, never dominant), each event stating its **model impact**
("NONE until verified"), plus a Diamond-Edge-vs-Crowd divergence indicator.
