/* ============================================================================
   useSavedPlayers — a small client hook over the saved-players store. Loads the
   current user's Favorites + Follows (Supabase when authenticated, else the
   localStorage baseline) and exposes the toggles. Favorites and Follows stay
   SEPARATE (never one boolean). Preference data is user-only, never model input.
   ========================================================================== */

"use client";

import { useCallback, useEffect, useState } from "react";
import {
  isFavorite as pureIsFavorite,
  isFollowing as pureIsFollowing,
  activeFollows,
  favoriteIds,
  EMPTY_SAVED_STATE,
} from "@/lib/players/saved-players";
import {
  loadSavedPlayers,
  toggleFavorite as storeToggleFavorite,
  toggleFollow as storeToggleFollow,
  type SavedPlayersStore,
} from "@/lib/players/store";

export interface UseSavedPlayers {
  loading: boolean;
  backend: "supabase" | "local" | "loading";
  favoriteIds: number[];
  followIds: number[];
  isFavorite: (playerId: number) => boolean;
  isFollowing: (playerId: number) => boolean;
  toggleFavorite: (playerId: number) => Promise<void>;
  toggleFollow: (playerId: number, opts?: { preferredMetrics?: string[] }) => Promise<void>;
  refresh: () => Promise<void>;
}

export function useSavedPlayers(): UseSavedPlayers {
  const [store, setStore] = useState<SavedPlayersStore>({ backend: "local", state: EMPTY_SAVED_STATE });
  const [loading, setLoading] = useState(true);

  const refresh = useCallback(async () => {
    const next = await loadSavedPlayers();
    setStore(next);
    setLoading(false);
  }, []);

  useEffect(() => {
    let active = true;
    loadSavedPlayers().then((next) => {
      if (!active) return;
      setStore(next);
      setLoading(false);
    });
    return () => {
      active = false;
    };
  }, []);

  const toggleFavorite = useCallback(async (playerId: number) => {
    const next = await storeToggleFavorite(store, playerId);
    setStore(next);
  }, [store]);

  const toggleFollow = useCallback(
    async (playerId: number, opts?: { preferredMetrics?: string[] }) => {
      const next = await storeToggleFollow(store, playerId, opts ?? {});
      setStore(next);
    },
    [store],
  );

  return {
    loading,
    backend: loading ? "loading" : store.backend,
    favoriteIds: favoriteIds(store.state),
    followIds: activeFollows(store.state).map((f) => f.playerId),
    isFavorite: (id) => pureIsFavorite(store.state, id),
    isFollowing: (id) => pureIsFollowing(store.state, id),
    toggleFavorite,
    toggleFollow,
    refresh,
  };
}
