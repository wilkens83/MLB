-- ============================================================================
-- Diamond Edge — user Player Favorites & Following.
--
-- ADDITIVE ONLY. This migration introduces TWO new user-owned tables and does
-- NOT touch any existing legacy or scientific table.
--
-- Favorites and Follows are kept as TWO SEPARATE concepts (never one boolean):
--  * user_player_favorites — a lightweight bookmark.
--  * user_player_follows    — opt-in performance tracking, with display-only
--    preferences (notes, preferred_metrics). These preferences are USER DATA
--    ONLY and never feed the projection/simulation model.
--
-- Identity is the canonical MLBAM player id (bigint), never a name.
--
-- Security model
--  * Both tables are user-owned and mutable (unlike the immutable scientific
--    tables). RLS restricts every row to its owner via auth.uid(): a user can
--    only ever read/insert/update/delete their OWN rows. There is no cross-user
--    visibility and the client can never write another user's saved players.
--  * user_id defaults to auth.uid() so a browser insert is always self-owned.
--  * A unique (user_id, player_id) constraint enforces "one row per player" at
--    the database level, matching the dedup guarantee in the pure store.
-- ============================================================================

-- Reuses the existing hardened `se_touch_updated_at()` trigger function from the
-- scientific-persistence migration (search_path pinned) to keep updated_at fresh
-- on mutable follow rows — no new function is introduced.

-- ---------------------------------------------------------------------------
-- 1. user_player_favorites — a lightweight bookmark (one row per player)
-- ---------------------------------------------------------------------------
create table public.user_player_favorites (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null default auth.uid() references auth.users(id) on delete cascade,
  player_id bigint not null,            -- canonical MLBAM id (never a name)
  created_at timestamptz not null default now(),
  unique (user_id, player_id)
);
create index user_player_favorites_user_idx on public.user_player_favorites (user_id, created_at);

-- ---------------------------------------------------------------------------
-- 2. user_player_follows — opt-in performance tracking (one row per player)
-- ---------------------------------------------------------------------------
create table public.user_player_follows (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null default auth.uid() references auth.users(id) on delete cascade,
  player_id bigint not null,            -- canonical MLBAM id (never a name)
  is_active boolean not null default true,
  notes text,
  -- Display-only metric preferences. NEVER an input to the model.
  preferred_metrics text[] not null default '{}',
  last_viewed_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (user_id, player_id)
);
create index user_player_follows_user_idx on public.user_player_follows (user_id, is_active, created_at);

create trigger user_player_follows_touch
  before update on public.user_player_follows
  for each row execute function public.se_touch_updated_at();

-- ---------------------------------------------------------------------------
-- Row Level Security — every row is owned by, and only visible to, its user.
-- ---------------------------------------------------------------------------
alter table public.user_player_favorites enable row level security;
alter table public.user_player_follows   enable row level security;

-- Favorites: full CRUD scoped to the owner.
create policy favorites_select_own on public.user_player_favorites
  for select to authenticated using (user_id = auth.uid());
create policy favorites_insert_own on public.user_player_favorites
  for insert to authenticated with check (user_id = auth.uid());
create policy favorites_delete_own on public.user_player_favorites
  for delete to authenticated using (user_id = auth.uid());

-- Follows: full CRUD scoped to the owner (update allowed for is_active /
-- notes / preferred_metrics / last_viewed_at, always on the owner's own row).
create policy follows_select_own on public.user_player_follows
  for select to authenticated using (user_id = auth.uid());
create policy follows_insert_own on public.user_player_follows
  for insert to authenticated with check (user_id = auth.uid());
create policy follows_update_own on public.user_player_follows
  for update to authenticated using (user_id = auth.uid()) with check (user_id = auth.uid());
create policy follows_delete_own on public.user_player_follows
  for delete to authenticated using (user_id = auth.uid());

comment on table public.user_player_favorites is
  'User bookmarks of MLB players (canonical MLBAM id). Separate from follows. RLS: owner-only.';
comment on table public.user_player_follows is
  'User-followed MLB players for performance tracking (canonical MLBAM id). preferred_metrics is a display preference and never feeds the model. RLS: owner-only.';
