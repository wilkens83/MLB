/* ============================================================================
   Saved-player state — Favorites (a lightweight bookmark) and Following (opt-in
   performance tracking) kept as TWO SEPARATE concepts. A player may be neither,
   favorite-only, follow-only, or both. Identity is the canonical MLBAM player id
   (a number) — display names are cached in the UI layer, NEVER the identity.

   Pure + deterministic: every operation returns a NEW state (append-only-ish,
   dedup-enforced). This is USER PREFERENCE data only — it must never feed the
   model (see docs: following/favoriting never affects predictions).
   ========================================================================== */

export interface FavoriteRecord {
  playerId: number; // canonical MLBAM id
  createdAt: string; // ISO
}

export interface FollowRecord {
  playerId: number; // canonical MLBAM id
  createdAt: string;
  isActive: boolean;
  lastViewedAt?: string;
  notes?: string;
  /** User-chosen metrics to surface (display preference only, never model input). */
  preferredMetrics?: string[];
}

export interface SavedPlayersState {
  favorites: FavoriteRecord[];
  follows: FollowRecord[];
}

export const EMPTY_SAVED_STATE: SavedPlayersState = { favorites: [], follows: [] };

const now = () => new Date().toISOString();

export function isFavorite(state: SavedPlayersState, playerId: number): boolean {
  return state.favorites.some((f) => f.playerId === playerId);
}

export function isFollowing(state: SavedPlayersState, playerId: number): boolean {
  return state.follows.some((f) => f.playerId === playerId && f.isActive);
}

/** Add a favorite. Duplicate (same player) is a no-op — never a second row. */
export function addFavorite(state: SavedPlayersState, playerId: number, at = now()): SavedPlayersState {
  if (isFavorite(state, playerId)) return state;
  return { ...state, favorites: [...state.favorites, { playerId, createdAt: at }] };
}

export function removeFavorite(state: SavedPlayersState, playerId: number): SavedPlayersState {
  return { ...state, favorites: state.favorites.filter((f) => f.playerId !== playerId) };
}

/** Follow a player. Duplicate is a no-op; re-following a soft-removed player
    reactivates it (keeps the original createdAt + preferences). */
export function addFollow(
  state: SavedPlayersState,
  playerId: number,
  opts: { notes?: string; preferredMetrics?: string[]; at?: string } = {},
): SavedPlayersState {
  const existing = state.follows.find((f) => f.playerId === playerId);
  if (existing) {
    if (existing.isActive) return state; // duplicate active follow → no-op
    return {
      ...state,
      follows: state.follows.map((f) => (f.playerId === playerId ? { ...f, isActive: true } : f)),
    };
  }
  return {
    ...state,
    follows: [...state.follows, {
      playerId, createdAt: opts.at ?? now(), isActive: true,
      notes: opts.notes, preferredMetrics: opts.preferredMetrics,
    }],
  };
}

export function removeFollow(state: SavedPlayersState, playerId: number): SavedPlayersState {
  return { ...state, follows: state.follows.filter((f) => f.playerId !== playerId) };
}

export function setPreferredMetrics(state: SavedPlayersState, playerId: number, metrics: string[]): SavedPlayersState {
  return {
    ...state,
    follows: state.follows.map((f) => (f.playerId === playerId ? { ...f, preferredMetrics: metrics } : f)),
  };
}

export function markViewed(state: SavedPlayersState, playerId: number, at = now()): SavedPlayersState {
  return {
    ...state,
    follows: state.follows.map((f) => (f.playerId === playerId ? { ...f, lastViewedAt: at } : f)),
  };
}

/** Active follows, most recent first. */
export function activeFollows(state: SavedPlayersState): FollowRecord[] {
  return state.follows.filter((f) => f.isActive).sort((a, b) => b.createdAt.localeCompare(a.createdAt));
}

export function favoriteIds(state: SavedPlayersState): number[] {
  return state.favorites.map((f) => f.playerId);
}
