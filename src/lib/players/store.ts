/* ============================================================================
   Saved-players persistence (client). Favorites + Follows are stored per user.

   Backend selection is graceful and automatic:
     * When Supabase is configured AND an authenticated session exists, rows are
       read/written to `user_player_favorites` / `user_player_follows` (RLS
       scopes every row to auth.uid(), so a user only ever sees their own).
     * Otherwise (keyless dev, no auth UI wired, offline) it degrades to a
       localStorage baseline behind the SAME function surface.

   All mutation goes through the PURE ops in `saved-players.ts`, so the dedup /
   separation invariants (favorite ≠ follow, one row per player, identity is the
   MLBAM id) hold identically in both backends. Preference data (notes,
   preferredMetrics) is user data only and is never an input to the model.
   ========================================================================== */

"use client";

import { getBrowserClient } from "@/lib/supabase/browser";
import {
  EMPTY_SAVED_STATE,
  addFavorite,
  removeFavorite,
  addFollow,
  removeFollow,
  setPreferredMetrics,
  markViewed,
  type SavedPlayersState,
  type FavoriteRecord,
  type FollowRecord,
} from "./saved-players";

const LS_KEY = "dp-saved-players";

/* ----------------------------- localStorage -------------------------------- */

function lsRead(): SavedPlayersState {
  if (typeof window === "undefined") return EMPTY_SAVED_STATE;
  try {
    const raw = localStorage.getItem(LS_KEY);
    if (!raw) return EMPTY_SAVED_STATE;
    const parsed = JSON.parse(raw) as Partial<SavedPlayersState>;
    return {
      favorites: Array.isArray(parsed.favorites) ? parsed.favorites : [],
      follows: Array.isArray(parsed.follows) ? parsed.follows : [],
    };
  } catch {
    return EMPTY_SAVED_STATE;
  }
}

function lsWrite(state: SavedPlayersState) {
  if (typeof window === "undefined") return;
  try {
    localStorage.setItem(LS_KEY, JSON.stringify(state));
  } catch {
    /* ignore quota */
  }
}

/* ------------------------------ Supabase ---------------------------------- */

/** Resolve the current authenticated user id, or null when unauthenticated. */
async function currentUserId(): Promise<string | null> {
  const client = getBrowserClient();
  if (!client) return null;
  try {
    const { data } = await client.auth.getUser();
    return data.user?.id ?? null;
  } catch {
    return null;
  }
}

async function supabaseLoad(userId: string): Promise<SavedPlayersState> {
  const client = getBrowserClient()!;
  const [favRes, folRes] = await Promise.all([
    client.from("user_player_favorites").select("player_id, created_at").eq("user_id", userId),
    client
      .from("user_player_follows")
      .select("player_id, created_at, is_active, notes, preferred_metrics, last_viewed_at")
      .eq("user_id", userId),
  ]);
  if (favRes.error) throw favRes.error;
  if (folRes.error) throw folRes.error;
  const favorites: FavoriteRecord[] = (favRes.data ?? []).map((r) => ({
    playerId: Number(r.player_id),
    createdAt: r.created_at,
  }));
  const follows: FollowRecord[] = (folRes.data ?? []).map((r) => ({
    playerId: Number(r.player_id),
    createdAt: r.created_at,
    isActive: r.is_active,
    notes: r.notes ?? undefined,
    preferredMetrics: r.preferred_metrics ?? undefined,
    lastViewedAt: r.last_viewed_at ?? undefined,
  }));
  return { favorites, follows };
}

/* --------------------------- Public store API ------------------------------ */

/**
 * A single mutation applied to whichever backend is active. Each op mutates the
 * pure state AND persists it. Supabase ops are best-effort: a failure falls back
 * to the localStorage baseline so the UI never wedges.
 */
export interface SavedPlayersStore {
  backend: "supabase" | "local";
  state: SavedPlayersState;
}

/** Load the current user's saved players from the best available backend. */
export async function loadSavedPlayers(): Promise<SavedPlayersStore> {
  const userId = await currentUserId();
  if (userId) {
    try {
      const state = await supabaseLoad(userId);
      return { backend: "supabase", state };
    } catch {
      // fall through to local baseline
    }
  }
  return { backend: "local", state: lsRead() };
}

export async function toggleFavorite(
  store: SavedPlayersStore,
  playerId: number,
): Promise<SavedPlayersStore> {
  const has = store.state.favorites.some((f) => f.playerId === playerId);
  const next = has ? removeFavorite(store.state, playerId) : addFavorite(store.state, playerId);
  if (store.backend === "supabase") {
    const userId = await currentUserId();
    const client = getBrowserClient();
    if (userId && client) {
      try {
        if (has) {
          await client.from("user_player_favorites").delete().eq("user_id", userId).eq("player_id", playerId);
        } else {
          await client
            .from("user_player_favorites")
            .upsert({ user_id: userId, player_id: playerId }, { onConflict: "user_id,player_id" });
        }
        return { ...store, state: next };
      } catch {
        /* fall through to local */
      }
    }
  }
  lsWrite(next);
  return { backend: "local", state: next };
}

export async function toggleFollow(
  store: SavedPlayersStore,
  playerId: number,
  opts: { notes?: string; preferredMetrics?: string[] } = {},
): Promise<SavedPlayersStore> {
  const active = store.state.follows.some((f) => f.playerId === playerId && f.isActive);
  const next = active ? removeFollow(store.state, playerId) : addFollow(store.state, playerId, opts);
  if (store.backend === "supabase") {
    const userId = await currentUserId();
    const client = getBrowserClient();
    if (userId && client) {
      try {
        if (active) {
          await client.from("user_player_follows").delete().eq("user_id", userId).eq("player_id", playerId);
        } else {
          await client.from("user_player_follows").upsert(
            {
              user_id: userId,
              player_id: playerId,
              is_active: true,
              notes: opts.notes ?? null,
              preferred_metrics: opts.preferredMetrics ?? [],
            },
            { onConflict: "user_id,player_id" },
          );
        }
        return { ...store, state: next };
      } catch {
        /* fall through to local */
      }
    }
  }
  lsWrite(next);
  return { backend: "local", state: next };
}

export async function updatePreferredMetrics(
  store: SavedPlayersStore,
  playerId: number,
  metrics: string[],
): Promise<SavedPlayersStore> {
  const next = setPreferredMetrics(store.state, playerId, metrics);
  if (store.backend === "supabase") {
    const userId = await currentUserId();
    const client = getBrowserClient();
    if (userId && client) {
      try {
        await client
          .from("user_player_follows")
          .update({ preferred_metrics: metrics })
          .eq("user_id", userId)
          .eq("player_id", playerId);
        return { ...store, state: next };
      } catch {
        /* fall through */
      }
    }
  }
  lsWrite(next);
  return { backend: "local", state: next };
}

export async function recordView(
  store: SavedPlayersStore,
  playerId: number,
): Promise<SavedPlayersStore> {
  const at = new Date().toISOString();
  const next = markViewed(store.state, playerId, at);
  if (store.backend === "supabase") {
    const userId = await currentUserId();
    const client = getBrowserClient();
    if (userId && client) {
      try {
        await client
          .from("user_player_follows")
          .update({ last_viewed_at: at })
          .eq("user_id", userId)
          .eq("player_id", playerId);
        return { ...store, state: next };
      } catch {
        /* fall through */
      }
    }
  }
  lsWrite(next);
  return { backend: "local", state: next };
}
