-- ============================================================================
-- Diamond Edge — scientific persistence layer (append-only, point-in-time).
--
-- ADDITIVE ONLY. This migration does NOT touch the pre-existing legacy user
-- tables (predictions, bets, odds, api_cache, players, teams, user_settings),
-- which are user-owned/mutable and predate this repo's Supabase integration.
-- It introduces the twelve immutable, server-authoritative scientific entities.
--
-- Security model
--  * System scientific tables have RLS enabled with NO client write policy:
--    only the service role (server, BYPASSRLS) may write them. Authenticated
--    users get read-only SELECT so the UI can render analytics.
--  * prizepicks_line_snapshots additionally lets an authenticated user insert /
--    read their OWN manual line snapshots (never verified by the client).
--  * Immutable tables are protected by append-only triggers that block UPDATE
--    and DELETE for EVERY role (including the service role), so history is never
--    rewritten. Corrections append a new row that references the superseded one.
-- ============================================================================

-- ---------------------------------------------------------------------------
-- Guards
-- ---------------------------------------------------------------------------

-- Blocks UPDATE and DELETE on strictly append-only scientific tables.
create or replace function public.se_enforce_append_only()
returns trigger
language plpgsql
as $$
begin
  raise exception 'append_only_violation: % on % is not permitted; scientific records are immutable — append a new row referencing the previous one',
    tg_op, tg_table_name
    using errcode = 'restrict_violation';
  return null;
end;
$$;

-- Allows UPDATE only of a circuit breaker's resolution columns; blocks DELETE
-- and any attempt to rewrite the triggering evidence.
create or replace function public.se_enforce_breaker_resolve_only()
returns trigger
language plpgsql
as $$
begin
  if tg_op = 'DELETE' then
    raise exception 'append_only_violation: DELETE on % is not permitted', tg_table_name
      using errcode = 'restrict_violation';
  end if;
  if new.model_id is distinct from old.model_id
     or new.market_key is distinct from old.market_key
     or new.breaker_type is distinct from old.breaker_type
     or new.severity is distinct from old.severity
     or new.reason is distinct from old.reason
     or new.evidence is distinct from old.evidence
     or new.triggered_at is distinct from old.triggered_at
     or new.decision_snapshot_id is distinct from old.decision_snapshot_id then
    raise exception 'append_only_violation: only resolution columns (status, resolved_at, resolution_note, resolved_by, recovery_condition) may be updated on %', tg_table_name
      using errcode = 'restrict_violation';
  end if;
  return new;
end;
$$;

-- ---------------------------------------------------------------------------
-- 1. raw_observations — immutable point-in-time source facts
-- ---------------------------------------------------------------------------
create table public.raw_observations (
  id uuid primary key default gen_random_uuid(),
  source text not null,
  observation_type text not null,
  source_record_id text,
  entity_type text not null,
  entity_id text not null,
  game_pk bigint,
  event_time timestamptz,
  effective_at timestamptz not null,
  available_at timestamptz not null,
  captured_at timestamptz not null default now(),
  payload jsonb not null,
  payload_hash text not null,
  schema_version text not null default '1',
  parser_version text not null default '1',
  constraint raw_observations_available_after_effective check (available_at >= effective_at)
);
comment on column public.raw_observations.available_at is
  'When this fact became knowable. A feature snapshot may only consume observations with available_at <= its feature_cutoff (enforced at the query layer + tested).';
create index raw_observations_entity_idx on public.raw_observations (entity_type, entity_id, available_at);
create index raw_observations_game_idx on public.raw_observations (game_pk);
create index raw_observations_type_idx on public.raw_observations (observation_type, available_at);

-- ---------------------------------------------------------------------------
-- 2. prizepicks_line_snapshots — append-only imported line history
-- ---------------------------------------------------------------------------
create table public.prizepicks_line_snapshots (
  id uuid primary key default gen_random_uuid(),
  user_id uuid default auth.uid() references auth.users(id) on delete set null,
  entry_id text not null,
  player_id bigint,
  game_pk bigint,
  game_number integer,
  market_key text not null,
  line numeric not null,
  projection_type text not null default 'standard'
    check (projection_type in ('standard','goblin','demon','unknown')),
  source_type text not null
    check (source_type in ('manual','csv','reviewed-image-import','browser-assisted-import','authorized-provider')),
  source_reference text,
  captured_at timestamptz not null default now(),
  is_verified boolean not null default false,
  supersedes_id uuid references public.prizepicks_line_snapshots(id),
  payload_hash text not null
);
create index pp_line_entry_idx on public.prizepicks_line_snapshots (entry_id, captured_at);
create index pp_line_player_idx on public.prizepicks_line_snapshots (player_id, market_key, captured_at);

-- ---------------------------------------------------------------------------
-- 3. payout_snapshots — append-only payout tables (verified vs generic)
-- ---------------------------------------------------------------------------
create table public.payout_snapshots (
  id uuid primary key default gen_random_uuid(),
  entry_id text,
  format text not null check (format in ('power','flex')),
  pick_count integer not null check (pick_count between 2 and 6),
  tier_composition jsonb,
  rules jsonb not null,
  source text not null,
  is_verified boolean not null default false,
  version text not null,
  effective_from timestamptz,
  effective_to timestamptz,
  captured_at timestamptz not null default now(),
  payload_hash text not null
);
create index payout_entry_idx on public.payout_snapshots (entry_id, captured_at);
create index payout_format_idx on public.payout_snapshots (format, pick_count, version);

-- ---------------------------------------------------------------------------
-- 9. model_registry — trusted source of model lifecycle state (mutable)
--    (created before feature/projection so they can FK to it)
-- ---------------------------------------------------------------------------
create table public.model_registry (
  id uuid primary key default gen_random_uuid(),
  market_key text not null,
  model_name text not null,
  model_version text not null,
  feature_version text not null,
  algorithm text,
  hyperparameters jsonb,
  training_period_start timestamptz,
  training_period_end timestamptz,
  validation_period_start timestamptz,
  validation_period_end timestamptz,
  training_data_hash text,
  training_support jsonb,
  git_commit_sha text,
  lifecycle_status text not null default 'RESEARCH_ONLY'
    check (lifecycle_status in (
      'DEVELOPMENT','BACKTEST_ONLY','SHADOW','RESEARCH_ONLY','PROVISIONAL',
      'VALIDATED','PRODUCTION','SUSPENDED','RETIRED')),
  approved_at timestamptz,
  approved_by text,
  suspended_at timestamptz,
  suspended_reason text,
  retired_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (market_key, model_name, model_version, feature_version)
);
create index model_registry_market_idx on public.model_registry (market_key, lifecycle_status);

-- ---------------------------------------------------------------------------
-- 4. feature_snapshots — immutable point-in-time feature vectors
-- ---------------------------------------------------------------------------
create table public.feature_snapshots (
  id uuid primary key default gen_random_uuid(),
  entity_type text not null,
  entity_id text not null,
  game_pk bigint,
  market_key text not null,
  feature_cutoff timestamptz not null,
  data_as_of timestamptz not null,
  computed_at timestamptz not null default now(),
  feature_version text not null,
  features jsonb not null,
  missing_features jsonb not null default '[]'::jsonb,
  source_observation_ids uuid[] not null default '{}',
  source_hash text not null,
  constraint feature_snapshots_asof_le_cutoff check (data_as_of <= feature_cutoff)
);
create index feature_snapshots_entity_idx on public.feature_snapshots (entity_type, entity_id, market_key, feature_cutoff);
create index feature_snapshots_game_idx on public.feature_snapshots (game_pk);

-- ---------------------------------------------------------------------------
-- 5. projection_snapshots — immutable model projections against a line
--    (same line may have MANY projections: lineup/pitcher/weather/feature/
--     model/cutoff changes each produce a new snapshot — no uniqueness rule)
-- ---------------------------------------------------------------------------
create table public.projection_snapshots (
  id uuid primary key default gen_random_uuid(),
  line_snapshot_id uuid references public.prizepicks_line_snapshots(id),
  feature_snapshot_id uuid references public.feature_snapshots(id),
  model_id uuid references public.model_registry(id),
  player_id bigint,
  game_pk bigint,
  market_key text not null,
  line numeric not null,
  distribution_summary jsonb,
  prob_more numeric check (prob_more between 0 and 1),
  prob_less numeric check (prob_less between 0 and 1),
  prob_push numeric check (prob_push between 0 and 1),
  confidence numeric,
  data_quality numeric,
  volatility numeric,
  fragility numeric,
  model_version text not null,
  feature_version text not null,
  feature_cutoff timestamptz not null,
  data_as_of timestamptz not null,
  generated_at timestamptz not null default now(),
  event_start_time timestamptz,
  input_hash text not null,
  config_checksum text not null,
  constraint projection_cutoff_le_event check (event_start_time is null or feature_cutoff <= event_start_time)
);
create index projection_line_idx on public.projection_snapshots (line_snapshot_id);
create index projection_player_idx on public.projection_snapshots (player_id, market_key, generated_at);
create index projection_game_idx on public.projection_snapshots (game_pk);

-- ---------------------------------------------------------------------------
-- 6. decision_snapshots — immutable firm decision records
-- ---------------------------------------------------------------------------
create table public.decision_snapshots (
  id uuid primary key default gen_random_uuid(),
  subject_type text not null check (subject_type in ('LEG','ENTRY')),
  subject_key text not null,
  entry_id text,
  projection_snapshot_id uuid references public.projection_snapshots(id),
  payout_snapshot_id uuid references public.payout_snapshots(id),
  decision text not null
    check (decision in ('BET_MORE','BET_LESS','APPROVE_ENTRY','WAIT','NO_BET','UNAVAILABLE')),
  policy_id text not null,
  policy_version text not null,
  model_version text not null,
  expected_return numeric,
  expected_profit numeric,
  variance numeric,
  downside_probability numeric,
  reasons jsonb not null default '[]'::jsonb,
  vetoes jsonb not null default '[]'::jsonb,
  scientific_facts jsonb,
  generated_at timestamptz not null default now(),
  feature_cutoff timestamptz not null,
  event_start_time timestamptz,
  input_hash text,
  config_checksum text not null,
  content_hash text not null,
  -- Invariant mirror of the engine's Zod superRefine: a LEG is never
  -- APPROVE_ENTRY; an ENTRY is never a directional BET.
  constraint decision_subject_taxonomy check (
    not (subject_type = 'LEG' and decision = 'APPROVE_ENTRY')
    and not (subject_type = 'ENTRY' and decision in ('BET_MORE','BET_LESS'))
  )
);
create index decision_subject_idx on public.decision_snapshots (subject_key, generated_at);
create index decision_entry_idx on public.decision_snapshots (entry_id, generated_at);
create index decision_projection_idx on public.decision_snapshots (projection_snapshot_id);

-- ---------------------------------------------------------------------------
-- 7. official_results — immutable official outcomes (corrections = new row)
-- ---------------------------------------------------------------------------
create table public.official_results (
  id uuid primary key default gen_random_uuid(),
  game_pk bigint not null,
  player_id bigint,
  market_key text not null,
  official_value numeric,
  game_status text not null,
  source text not null,
  source_record text,
  raw_observation_id uuid references public.raw_observations(id),
  retrieved_at timestamptz not null default now(),
  effective_at timestamptz not null,
  version integer not null default 1,
  supersedes_id uuid references public.official_results(id),
  payload_hash text not null
);
create index official_results_game_idx on public.official_results (game_pk, player_id, market_key);

-- ---------------------------------------------------------------------------
-- 8. grading_history — append-only grading events (never mutate decisions)
-- ---------------------------------------------------------------------------
create table public.grading_history (
  id uuid primary key default gen_random_uuid(),
  projection_snapshot_id uuid references public.projection_snapshots(id),
  decision_snapshot_id uuid references public.decision_snapshots(id),
  official_result_id uuid references public.official_results(id),
  selected_side text check (selected_side in ('more','less')),
  actual_side text check (actual_side in ('more','less','push','void')),
  previous_grade text,
  new_grade text not null check (new_grade in ('win','loss','push','void')),
  actual_value numeric,
  grading_rule_version text not null,
  reason text,
  graded_at timestamptz not null default now()
);
create index grading_decision_idx on public.grading_history (decision_snapshot_id, graded_at);
create index grading_projection_idx on public.grading_history (projection_snapshot_id, graded_at);

-- ---------------------------------------------------------------------------
-- 10. market_validation_metrics — append-only scored windows
-- ---------------------------------------------------------------------------
create table public.market_validation_metrics (
  id uuid primary key default gen_random_uuid(),
  model_id uuid references public.model_registry(id),
  market_key text not null,
  window_type text not null,
  window_start timestamptz,
  window_end timestamptz,
  sample_count integer not null default 0,
  scored_count integer not null default 0,
  brier numeric,
  log_loss numeric,
  calibration jsonb,
  mae numeric,
  rmse numeric,
  expected_return numeric,
  realized_return numeric,
  max_drawdown numeric,
  longest_losing_streak integer,
  baseline_comparison jsonb,
  segment text,
  computed_at timestamptz not null default now()
);
create index mv_metrics_model_idx on public.market_validation_metrics (model_id, computed_at);
create index mv_metrics_market_idx on public.market_validation_metrics (market_key, window_type, computed_at);

-- ---------------------------------------------------------------------------
-- 11. drift_reports — append-only distribution-drift reports
-- ---------------------------------------------------------------------------
create table public.drift_reports (
  id uuid primary key default gen_random_uuid(),
  model_id uuid references public.model_registry(id),
  market_key text not null,
  feature_name text not null,
  feature_type text not null default 'continuous'
    check (feature_type in ('continuous','discrete','categorical','binary')),
  reference_window jsonb,
  current_window jsonb,
  metric text not null default 'psi',
  metric_value numeric,
  drift_level text not null check (drift_level in ('stable','moderate','significant','insufficient_data')),
  reference_count integer not null default 0,
  current_count integer not null default 0,
  insufficient_data boolean not null default false,
  breach boolean not null default false,
  thresholds jsonb,
  computed_at timestamptz not null default now()
);
create index drift_model_idx on public.drift_reports (model_id, computed_at);
create index drift_market_feature_idx on public.drift_reports (market_key, feature_name, computed_at);

-- ---------------------------------------------------------------------------
-- 12. circuit_breaker_events — triggered vetoes (resolution-updatable)
-- ---------------------------------------------------------------------------
create table public.circuit_breaker_events (
  id uuid primary key default gen_random_uuid(),
  model_id uuid references public.model_registry(id),
  market_key text,
  game_pk bigint,
  decision_snapshot_id uuid references public.decision_snapshots(id),
  breaker_type text not null,
  severity text not null default 'CRITICAL' check (severity in ('INFO','WARNING','CRITICAL')),
  status text not null default 'OPEN' check (status in ('OPEN','RESOLVED','OVERRIDDEN')),
  reason text not null,
  evidence jsonb,
  triggered_at timestamptz not null default now(),
  resolved_at timestamptz,
  resolution_note text,
  resolved_by text,
  recovery_condition text
);
create index breaker_model_idx on public.circuit_breaker_events (model_id, triggered_at);
create index breaker_status_idx on public.circuit_breaker_events (status, triggered_at);

-- ---------------------------------------------------------------------------
-- Append-only + resolution triggers
-- ---------------------------------------------------------------------------
create trigger raw_observations_append_only before update or delete on public.raw_observations for each row execute function public.se_enforce_append_only();
create trigger pp_line_append_only before update or delete on public.prizepicks_line_snapshots for each row execute function public.se_enforce_append_only();
create trigger payout_append_only before update or delete on public.payout_snapshots for each row execute function public.se_enforce_append_only();
create trigger feature_append_only before update or delete on public.feature_snapshots for each row execute function public.se_enforce_append_only();
create trigger projection_append_only before update or delete on public.projection_snapshots for each row execute function public.se_enforce_append_only();
create trigger decision_append_only before update or delete on public.decision_snapshots for each row execute function public.se_enforce_append_only();
create trigger official_results_append_only before update or delete on public.official_results for each row execute function public.se_enforce_append_only();
create trigger grading_append_only before update or delete on public.grading_history for each row execute function public.se_enforce_append_only();
create trigger mv_metrics_append_only before update or delete on public.market_validation_metrics for each row execute function public.se_enforce_append_only();
create trigger drift_append_only before update or delete on public.drift_reports for each row execute function public.se_enforce_append_only();
create trigger breaker_resolve_only before update or delete on public.circuit_breaker_events for each row execute function public.se_enforce_breaker_resolve_only();

-- model_registry keeps updated_at fresh on lifecycle transitions.
create or replace function public.se_touch_updated_at()
returns trigger language plpgsql as $$
begin new.updated_at = now(); return new; end; $$;
create trigger model_registry_touch before update on public.model_registry for each row execute function public.se_touch_updated_at();

-- ---------------------------------------------------------------------------
-- Row Level Security
-- ---------------------------------------------------------------------------
alter table public.raw_observations enable row level security;
alter table public.prizepicks_line_snapshots enable row level security;
alter table public.payout_snapshots enable row level security;
alter table public.feature_snapshots enable row level security;
alter table public.projection_snapshots enable row level security;
alter table public.decision_snapshots enable row level security;
alter table public.official_results enable row level security;
alter table public.grading_history enable row level security;
alter table public.model_registry enable row level security;
alter table public.market_validation_metrics enable row level security;
alter table public.drift_reports enable row level security;
alter table public.circuit_breaker_events enable row level security;

-- System scientific tables: authenticated may READ; no client write policy, so
-- only the service role (BYPASSRLS, server-only) can INSERT.
create policy read_raw_observations on public.raw_observations for select to authenticated using (true);
create policy read_payout_snapshots on public.payout_snapshots for select to authenticated using (true);
create policy read_feature_snapshots on public.feature_snapshots for select to authenticated using (true);
create policy read_projection_snapshots on public.projection_snapshots for select to authenticated using (true);
create policy read_decision_snapshots on public.decision_snapshots for select to authenticated using (true);
create policy read_official_results on public.official_results for select to authenticated using (true);
create policy read_grading_history on public.grading_history for select to authenticated using (true);
create policy read_model_registry on public.model_registry for select to authenticated using (true);
create policy read_mv_metrics on public.market_validation_metrics for select to authenticated using (true);
create policy read_drift_reports on public.drift_reports for select to authenticated using (true);
create policy read_breaker_events on public.circuit_breaker_events for select to authenticated using (true);

-- prizepicks_line_snapshots: a user may read + create their OWN manual lines,
-- but can never mark one verified (is_verified must be false on client insert).
create policy pp_line_select_own on public.prizepicks_line_snapshots
  for select to authenticated using (user_id = auth.uid());
create policy pp_line_insert_own on public.prizepicks_line_snapshots
  for insert to authenticated with check (user_id = auth.uid() and is_verified = false);
