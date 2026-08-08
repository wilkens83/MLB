-- ============================================================================
-- Additive migration: richer PrizePicks line verification + player name.
-- The prizepicks_line_snapshots table carried only a boolean is_verified; the
-- ingestion pipeline (prizepicks-import@1) tracks a 4-state lifecycle and the
-- imported player name. Both are added as nullable/defaulted columns so no
-- existing row or policy is affected (append-only trigger + RLS unchanged).
-- verification_status is SERVER-DERIVED: a browser insert defaults to IMPORTED
-- and the existing RLS still forbids a client from writing is_verified=true
-- without the trusted (service-role) path.
-- ============================================================================

alter table public.prizepicks_line_snapshots
  add column if not exists verification_status text not null default 'IMPORTED'
    check (verification_status in ('IMPORTED','NEEDS_REVIEW','VERIFIED','REJECTED'));

alter table public.prizepicks_line_snapshots
  add column if not exists player_name text;

comment on column public.prizepicks_line_snapshots.verification_status is
  'Server-derived line lifecycle: IMPORTED | NEEDS_REVIEW | VERIFIED | REJECTED. '
  'VERIFIED is only set through the trusted review gate, never from a raw import.';

-- Keep the legacy boolean consistent with the new state for existing rows.
update public.prizepicks_line_snapshots
  set verification_status = case when is_verified then 'VERIFIED' else 'IMPORTED' end
  where verification_status = 'IMPORTED' and is_verified is true;

create index if not exists pp_line_verification_idx
  on public.prizepicks_line_snapshots (verification_status, captured_at);
