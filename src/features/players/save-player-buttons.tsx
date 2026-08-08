/* ============================================================================
   Favorite (bookmark) + Follow (performance tracking) buttons. These are TWO
   SEPARATE controls — favoriting never follows and vice versa.

   Visual contract: the favorite control is a gold STAR (a bookmark affordance),
   deliberately NOT the model-positive green (`--positive`), so a saved player is
   never mistaken for a positive-EV signal. The follow control is a neutral/brand
   pill. Neither control touches the model.
   ========================================================================== */

"use client";

import { Star, Eye, EyeOff } from "lucide-react";
import { cn } from "@/lib/utils";
import { useSavedPlayers } from "./use-saved-players";

export function SavePlayerButtons({
  playerId,
  size = "md",
  className,
}: {
  playerId: number;
  size?: "sm" | "md";
  className?: string;
}) {
  const saved = useSavedPlayers();
  const fav = saved.isFavorite(playerId);
  const following = saved.isFollowing(playerId);
  const iconSize = size === "sm" ? "h-3.5 w-3.5" : "h-4 w-4";
  const pad = size === "sm" ? "px-2 py-1 text-[11px]" : "px-2.5 py-1.5 text-xs";

  return (
    <div className={cn("inline-flex items-center gap-1.5", className)}>
      <button
        type="button"
        aria-pressed={fav}
        aria-label={fav ? "Remove favorite" : "Add favorite"}
        title={fav ? "Favorited — a bookmark (not a betting signal)" : "Favorite (bookmark)"}
        onClick={(e) => {
          e.preventDefault();
          e.stopPropagation();
          void saved.toggleFavorite(playerId);
        }}
        className={cn(
          "inline-flex items-center gap-1 rounded-lg border font-medium transition-colors",
          pad,
          fav
            ? "border-[var(--warning)]/40 bg-[var(--warning)]/10 text-[var(--warning)]"
            : "border-border bg-surface-2 text-muted hover:text-foreground",
        )}
      >
        <Star className={cn(iconSize, fav && "fill-current")} />
        {size === "md" && (fav ? "Favorited" : "Favorite")}
      </button>

      <button
        type="button"
        aria-pressed={following}
        aria-label={following ? "Unfollow" : "Follow"}
        title={following ? "Following — tracks performance history" : "Follow to track performance"}
        onClick={(e) => {
          e.preventDefault();
          e.stopPropagation();
          void saved.toggleFollow(playerId);
        }}
        className={cn(
          "inline-flex items-center gap-1 rounded-lg border font-medium transition-colors",
          pad,
          following
            ? "border-brand-500/50 bg-brand-500/10 text-brand-500"
            : "border-border bg-surface-2 text-muted hover:text-foreground",
        )}
      >
        {following ? <Eye className={iconSize} /> : <EyeOff className={iconSize} />}
        {size === "md" && (following ? "Following" : "Follow")}
      </button>
    </div>
  );
}
