/* ============================================================================
   My Players dashboard (client). A personal research space over the user's saved
   players. Favorites (bookmarks) and Following (performance tracking) are shown
   as SEPARATE groups. Followed players get a HISTORICAL performance card (via the
   followed-player-performance@1 workflow); favorites are a lightweight labeled
   list. Nothing here computes or displays a model probability.
   ========================================================================== */

"use client";

import { useMemo } from "react";
import Link from "next/link";
import { useQuery } from "@tanstack/react-query";
import { Star, Eye, Loader2, Search } from "lucide-react";
import { PlayerAvatar } from "@/components/player-avatar";
import { useSavedPlayers } from "./use-saved-players";
import { SavePlayerButtons } from "./save-player-buttons";
import { FollowedPlayerCard } from "./followed-player-card";
import type { FollowedPlayersDashboard } from "@/workflows/followed-player-performance";

interface ResolvedPlayer {
  id: number;
  name: string | null;
  team: string | null;
  position: string | null;
}

export function MyPlayersDashboard() {
  const saved = useSavedPlayers();
  const followKey = useMemo(() => [...saved.followIds].sort((a, b) => a - b).join(","), [saved.followIds]);
  const favKey = useMemo(() => [...saved.favoriteIds].sort((a, b) => a - b).join(","), [saved.favoriteIds]);

  const perfQuery = useQuery({
    queryKey: ["my-players-performance", followKey],
    enabled: !saved.loading && saved.followIds.length > 0,
    queryFn: async (): Promise<FollowedPlayersDashboard> => {
      const res = await fetch("/api/my-players/performance", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ players: saved.followIds.map((playerId) => ({ playerId })) }),
      });
      if (!res.ok) throw new Error("performance request failed");
      return res.json();
    },
  });

  const favQuery = useQuery({
    queryKey: ["my-players-favorites", favKey],
    enabled: !saved.loading && saved.favoriteIds.length > 0,
    queryFn: async (): Promise<{ players: ResolvedPlayer[] }> => {
      const res = await fetch(`/api/players/resolve?ids=${saved.favoriteIds.join(",")}`);
      if (!res.ok) throw new Error("resolve failed");
      return res.json();
    },
  });

  const nothingSaved = !saved.loading && saved.followIds.length === 0 && saved.favoriteIds.length === 0;

  return (
    <div className="space-y-6">
      {/* Header */}
      <div className="panel p-6">
        <div className="mb-2 inline-flex items-center gap-1.5 rounded-md border border-border bg-surface-2 px-2 py-0.5 text-[11px] font-medium text-muted">
          <Star className="h-3 w-3" /> My Players
        </div>
        <h1 className="text-2xl font-black tracking-tight">Your research dashboard</h1>
        <p className="mt-1.5 max-w-xl text-sm text-muted">
          Players you&apos;ve saved. <span className="font-medium text-foreground">Favorites</span> are bookmarks;{" "}
          <span className="font-medium text-foreground">Following</span> tracks a player&apos;s historical
          performance. Following never changes the model.
        </p>
        <div className="mt-4 flex flex-wrap items-center gap-4 text-sm">
          <span className="inline-flex items-center gap-1.5">
            <Star className="h-4 w-4 text-[var(--warning)]" />
            <span className="font-bold tabular-nums">{saved.favoriteIds.length}</span>
            <span className="text-muted">Favorites</span>
          </span>
          <span className="inline-flex items-center gap-1.5">
            <Eye className="h-4 w-4 text-brand-500" />
            <span className="font-bold tabular-nums">{saved.followIds.length}</span>
            <span className="text-muted">Following</span>
          </span>
          {saved.backend === "local" && (
            <span className="text-[11px] text-muted-2">Saved on this device</span>
          )}
        </div>
      </div>

      {saved.loading && (
        <div className="flex items-center gap-2 text-sm text-muted">
          <Loader2 className="h-4 w-4 animate-spin" /> Loading your players…
        </div>
      )}

      {nothingSaved && (
        <div className="panel flex flex-col items-center gap-3 p-10 text-center">
          <div className="grid h-12 w-12 place-items-center rounded-full bg-brand-500/10">
            <Star className="h-6 w-6 text-brand-500" />
          </div>
          <div>
            <div className="text-base font-semibold">Follow MLB players to build your personal research dashboard</div>
            <p className="mx-auto mt-1 max-w-md text-sm text-muted">
              Favorite players to bookmark them, or follow them to track their historical performance across your
              favorite prop markets.
            </p>
          </div>
          <Link
            href="/players"
            className="mt-1 inline-flex items-center gap-1.5 rounded-lg bg-brand-500 px-3.5 py-2 text-sm font-semibold text-white transition-colors hover:bg-brand-600"
          >
            <Search className="h-4 w-4" /> Browse Players
          </Link>
        </div>
      )}

      {/* Following */}
      {saved.followIds.length > 0 && (
        <section>
          <div className="mb-3 flex items-center gap-2">
            <Eye className="h-4 w-4 text-brand-500" />
            <h2 className="text-[13px] font-semibold uppercase tracking-wider text-muted">Following</h2>
          </div>
          {perfQuery.isLoading ? (
            <div className="flex items-center gap-2 text-sm text-muted">
              <Loader2 className="h-4 w-4 animate-spin" /> Computing historical performance…
            </div>
          ) : perfQuery.isError ? (
            <div className="panel p-4 text-sm text-muted">
              Performance data is temporarily unavailable. Nothing is shown rather than a fabricated stat.
            </div>
          ) : (
            <div className="grid grid-cols-1 gap-3 lg:grid-cols-2">
              {(perfQuery.data?.cards ?? []).map((card) => (
                <FollowedPlayerCard key={card.playerId} card={card} />
              ))}
            </div>
          )}
        </section>
      )}

      {/* Favorites */}
      {saved.favoriteIds.length > 0 && (
        <section>
          <div className="mb-3 flex items-center gap-2">
            <Star className="h-4 w-4 text-[var(--warning)]" />
            <h2 className="text-[13px] font-semibold uppercase tracking-wider text-muted">Favorites</h2>
          </div>
          <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-3">
            {saved.favoriteIds.map((id) => {
              const info = favQuery.data?.players.find((p) => p.id === id);
              return (
                <div key={id} className="panel flex items-center gap-3 p-3">
                  <Link href={`/players/${id}/analysis`} className="flex min-w-0 flex-1 items-center gap-3">
                    <PlayerAvatar playerId={id} name={info?.name ?? "Player"} size="md" shape="rounded" />
                    <div className="min-w-0">
                      <div className="truncate text-sm font-semibold">{info?.name ?? `Player ${id}`}</div>
                      <div className="truncate text-xs text-muted">
                        {[info?.team, info?.position].filter(Boolean).join(" · ") || " "}
                      </div>
                    </div>
                  </Link>
                  <SavePlayerButtons playerId={id} size="sm" />
                </div>
              );
            })}
          </div>
        </section>
      )}
    </div>
  );
}
