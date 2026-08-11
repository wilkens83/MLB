-- ============================================================================
-- Diamond Edge — Reddit ContextEvent persistence (append-only, point-in-time).
--
-- ADDITIVE ONLY. Introduces one system table for auditable, point-in-time Reddit
-- context signals. Every fetch appends a row (a capture); corrections never mutate
-- an earlier capture, so the full history of how a signal evolved is preserved and
-- a historical prediction can be reconstructed exactly (no future-data leakage).
--
-- Security model (mirrors the scientific tables)
--  * RLS enabled: only the service role (server) may write; authenticated users
--    get read-only SELECT so the UI/analytics can render.
--  * Append-only trigger blocks UPDATE and DELETE for EVERY role — history is
--    never rewritten. A superseding signal is a NEW row with a later captured_at.
--
-- Reddit is an early-warning/context source only. Nothing about this table lets
-- a Reddit signal modify a model probability — that rule lives in application code
-- (src/lib/research) and is enforced by the safety-invariant test.
-- ============================================================================

create table public.context_events (
  id uuid primary key default gen_random_uuid(),
  -- Deterministic ContextEvent id (reddit:player:type:firstSeen) — stable across
  -- captures so history for one signal can be grouped by event_key.
  event_key text not null,
  player_id bigint not null,
  game_pk bigint,
  type text not null,
  status text not null check (status in ('unverified','reported','confirmed','rejected')),
  severity text not null check (severity in ('critical','high','medium','info')),
  -- Confidence in the SIGNAL's existence/credibility (0..1) — never a game probability.
  confidence numeric not null check (confidence >= 0 and confidence <= 1),
  summary text not null,
  source_type text not null default 'reddit',
  mentions integer not null default 0,
  unique_threads integer not null default 0,
  subreddits text[] not null default '{}',
  first_seen_at timestamptz,
  last_seen_at timestamptz,
  credibility_level text check (credibility_level in ('low','medium','high')),
  credibility_reasons text[] not null default '{}',
  verification_note text,
  sources jsonb not null default '[]',
  -- Point-in-time: the moment this signal was knowable, and the moment we captured it.
  fetched_at timestamptz not null,
  captured_at timestamptz not null default now()
);
create index context_events_player_idx on public.context_events (player_id, captured_at desc);
create index context_events_game_idx on public.context_events (game_pk, captured_at desc);
create index context_events_key_idx on public.context_events (event_key, captured_at desc);

-- Append-only: block UPDATE/DELETE for every role (reuses the scientific guard).
create trigger context_events_append_only
  before update or delete on public.context_events
  for each row execute function public.se_enforce_append_only();

alter table public.context_events enable row level security;
create policy read_context_events on public.context_events
  for select to authenticated using (true);
-- No client write policy: only the service role (BYPASSRLS) may insert.

comment on table public.context_events is
  'Append-only, point-in-time Reddit context signals. Service-role write, authenticated read. Reddit never modifies a model probability; confidence is a signal-credibility score, not a game probability.';
