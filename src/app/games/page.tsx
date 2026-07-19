"use client";

import { useState } from "react";
import { useQuery, keepPreviousData } from "@tanstack/react-query";
import { ChevronLeft, ChevronRight, CalendarDays } from "lucide-react";
import { GameCard } from "@/components/game-card";
import { Button, Skeleton } from "@/components/ui/primitives";
import type { MlbGame } from "@/lib/mlb/types";

function isoDate(d: Date) {
  return d.toISOString().slice(0, 10);
}
function addDays(iso: string, n: number) {
  const d = new Date(iso + "T12:00:00Z");
  d.setUTCDate(d.getUTCDate() + n);
  return isoDate(d);
}
function pretty(iso: string) {
  return new Date(iso + "T12:00:00Z").toLocaleDateString("en-US", {
    weekday: "long",
    month: "short",
    day: "numeric",
  });
}

export default function GamesPage() {
  const [date, setDate] = useState(isoDate(new Date()));

  const { data, isFetching } = useQuery({
    queryKey: ["games", date],
    queryFn: async () => {
      const res = await fetch(`/api/games?date=${date}`);
      const json = (await res.json()) as { games: MlbGame[] };
      return json.games ?? [];
    },
    placeholderData: keepPreviousData,
  });

  const games = data ?? [];
  const sorted = [...games].sort((a, b) => {
    const rank = (s: string) => (s === "Live" ? 0 : s === "Preview" ? 1 : 2);
    return rank(a.status.abstractGameState) - rank(b.status.abstractGameState);
  });

  return (
    <div className="space-y-6">
      <div className="glass flex flex-wrap items-center justify-between gap-3 rounded-2xl p-4">
        <div className="flex items-center gap-2">
          <CalendarDays className="h-5 w-5 text-brand-500" />
          <div>
            <div className="text-lg font-bold leading-tight">{pretty(date)}</div>
            <div className="text-xs text-muted">{games.length} games</div>
          </div>
        </div>
        <div className="flex items-center gap-2">
          <Button variant="outline" size="icon" onClick={() => setDate((d) => addDays(d, -1))} aria-label="Previous day">
            <ChevronLeft className="h-4 w-4" />
          </Button>
          <input
            type="date"
            value={date}
            onChange={(e) => setDate(e.target.value)}
            className="h-9 rounded-lg border border-border bg-surface px-3 text-sm outline-none"
          />
          <Button variant="outline" size="sm" onClick={() => setDate(isoDate(new Date()))}>
            Today
          </Button>
          <Button variant="outline" size="icon" onClick={() => setDate((d) => addDays(d, 1))} aria-label="Next day">
            <ChevronRight className="h-4 w-4" />
          </Button>
        </div>
      </div>

      {isFetching && games.length === 0 ? (
        <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
          {Array.from({ length: 6 }).map((_, i) => (
            <Skeleton key={i} className="h-40 rounded-2xl" />
          ))}
        </div>
      ) : sorted.length === 0 ? (
        <div className="glass rounded-2xl p-10 text-center text-muted">No games scheduled.</div>
      ) : (
        <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
          {sorted.map((g, i) => (
            <GameCard key={g.gamePk} game={g} index={i} />
          ))}
        </div>
      )}
    </div>
  );
}
