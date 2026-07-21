"use client";

import { useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { ChevronDown, ChevronRight, Clock, MapPin, Circle } from "lucide-react";
import { TeamLogo } from "@/components/team-logo";
import { Skeleton } from "@/components/ui/primitives";
import { MarketCard } from "./market-card";
import type { SlateGameNode } from "@/lib/mlb/slate";
import type { MarketGameCards, MarketCard as CardData } from "@/lib/mlb/market";

export interface CardFilters {
  role: "all" | "batters" | "pitchers";
  minDataQuality: number;
  minProjection: number;
  search: string;
  home: "all" | "home" | "away";
}

export function GameGroup({
  game,
  market,
  date,
  defaultOpen,
  filters,
}: {
  game: SlateGameNode;
  market: string;
  date?: string;
  defaultOpen?: boolean;
  filters: CardFilters;
}) {
  const [open, setOpen] = useState(!!defaultOpen);

  const { data, isLoading } = useQuery({
    queryKey: ["market-game", game.gamePk, market, date],
    queryFn: async () =>
      (await fetch(`/api/market/game?gamePk=${game.gamePk}&market=${market}${date ? `&date=${date}` : ""}`)).json() as Promise<MarketGameCards>,
    enabled: open,
    staleTime: 120_000,
  });

  const cards = applyFilters(data?.cards ?? [], filters);
  const isLive = game.state === "live";

  return (
    <div className="glass rounded-2xl">
      <button onClick={() => setOpen((o) => !o)} className="flex w-full items-center gap-3 p-4 text-left">
        {open ? <ChevronDown className="h-4 w-4 text-muted" /> : <ChevronRight className="h-4 w-4 text-muted" />}
        <TeamLogo teamId={game.away.teamId} name={game.away.teamName} size={26} />
        <TeamLogo teamId={game.home.teamId} name={game.home.teamName} size={26} />
        <div className="min-w-0 flex-1">
          <div className="truncate text-sm font-semibold">
            {game.away.teamName} @ {game.home.teamName}
          </div>
          <div className="flex items-center gap-2 text-[11px] text-muted">
            {isLive ? (
              <span className="flex items-center gap-1 text-[var(--negative)]">
                <Circle className="h-2 w-2 animate-pulse fill-current" /> Live
              </span>
            ) : (
              <span className="flex items-center gap-1">
                <Clock className="h-3 w-3" /> {gameTime(game.date)}
              </span>
            )}
            {game.venueName && (
              <span className="flex items-center gap-1 truncate">
                <MapPin className="h-3 w-3" /> {game.venueName}
              </span>
            )}
          </div>
        </div>
        {open && data && <span className="text-xs text-muted">{cards.length}</span>}
      </button>

      {open && (
        <div className="p-3 pt-0">
          {isLoading ? (
            <div className="grid gap-3 sm:grid-cols-2">
              {Array.from({ length: 4 }).map((_, i) => (
                <Skeleton key={i} className="h-52 rounded-2xl" />
              ))}
            </div>
          ) : cards.length === 0 ? (
            <p className="px-2 py-4 text-sm text-muted">
              No players match this market/filters. Team &amp; game markets are on the Games pages.
            </p>
          ) : (
            <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-3">
              {cards.map((c) => (
                <MarketCard key={c.playerId} card={c} />
              ))}
            </div>
          )}
        </div>
      )}
    </div>
  );
}

function applyFilters(cards: CardData[], f: CardFilters): CardData[] {
  const q = f.search.trim().toLowerCase();
  return cards.filter((c) => {
    if (f.role === "batters" && c.isPitcher) return false;
    if (f.role === "pitchers" && !c.isPitcher) return false;
    if (f.home === "home" && !c.isHome) return false;
    if (f.home === "away" && c.isHome) return false;
    if (c.dataQuality < f.minDataQuality) return false;
    if (c.projection < f.minProjection) return false;
    if (q && !c.name.toLowerCase().includes(q) && !c.teamName.toLowerCase().includes(q)) return false;
    return true;
  });
}

function gameTime(iso: string) {
  return new Date(iso).toLocaleTimeString("en-US", { hour: "numeric", minute: "2-digit" });
}
