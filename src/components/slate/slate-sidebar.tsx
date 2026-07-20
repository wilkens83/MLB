"use client";

import { useMemo, useState } from "react";
import { ChevronDown, ChevronRight, Search, Circle } from "lucide-react";
import { TeamLogo } from "@/components/team-logo";
import { cn } from "@/lib/utils";
import type { Slate, SlatePlayer, SlateGameNode } from "@/lib/mlb/slate";

type RoleFilter = "all" | "batters" | "pitchers";

export function SlateSidebar({
  slate,
  selectedId,
  onSelect,
}: {
  slate: Slate;
  selectedId?: number;
  onSelect: (p: SlatePlayer) => void;
}) {
  const [query, setQuery] = useState("");
  const [role, setRole] = useState<RoleFilter>("all");
  const [expanded, setExpanded] = useState<Set<number>>(() => new Set(slate.games.slice(0, 1).map((g) => g.gamePk)));

  const q = query.trim().toLowerCase();

  const filteredGames = useMemo(() => {
    return slate.games
      .map((g) => {
        const players = g.players.filter((p) => {
          if (role === "batters" && p.isPitcher) return false;
          if (role === "pitchers" && !p.isPitcher) return false;
          if (!q) return true;
          return (
            p.name.toLowerCase().includes(q) ||
            p.teamName.toLowerCase().includes(q) ||
            g.home.teamName.toLowerCase().includes(q) ||
            g.away.teamName.toLowerCase().includes(q)
          );
        });
        return { game: g, players };
      })
      .filter(({ players }) => players.length > 0 || (!q && role === "all"));
  }, [slate.games, q, role]);

  function toggle(pk: number) {
    setExpanded((prev) => {
      const next = new Set(prev);
      if (next.has(pk)) next.delete(pk);
      else next.add(pk);
      return next;
    });
  }

  return (
    <div className="flex h-full flex-col">
      <div className="space-y-2 p-3">
        <div className="glass flex items-center gap-2 rounded-xl px-3 h-9">
          <Search className="h-4 w-4 text-muted" />
          <input
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            placeholder="Search player, team, game…"
            className="w-full bg-transparent text-sm outline-none placeholder:text-muted-2"
          />
        </div>
        <div className="flex rounded-lg border border-border bg-surface p-0.5 text-xs">
          {(["all", "batters", "pitchers"] as RoleFilter[]).map((r) => (
            <button
              key={r}
              onClick={() => setRole(r)}
              className={cn(
                "flex-1 rounded-md py-1.5 font-medium capitalize transition-colors",
                role === r ? "bg-brand-500 text-white" : "text-muted hover:text-foreground",
              )}
            >
              {r}
            </button>
          ))}
        </div>
      </div>

      <div className="min-h-0 flex-1 overflow-y-auto px-2 pb-4">
        {filteredGames.map(({ game, players }) => (
          <GameGroup
            key={game.gamePk}
            game={game}
            players={q || role !== "all" ? players : expanded.has(game.gamePk) ? game.players : []}
            open={!!q || role !== "all" || expanded.has(game.gamePk)}
            onToggle={() => toggle(game.gamePk)}
            selectedId={selectedId}
            onSelect={onSelect}
            forceOpen={!!q || role !== "all"}
          />
        ))}
        {filteredGames.length === 0 && <p className="px-3 py-4 text-sm text-muted">No matches.</p>}
      </div>
    </div>
  );
}

function GameGroup({
  game,
  players,
  open,
  forceOpen,
  onToggle,
  selectedId,
  onSelect,
}: {
  game: SlateGameNode;
  players: SlatePlayer[];
  open: boolean;
  forceOpen: boolean;
  onToggle: () => void;
  selectedId?: number;
  onSelect: (p: SlatePlayer) => void;
}) {
  const isLive = game.state === "live";
  return (
    <div className="mb-1">
      <button
        onClick={forceOpen ? undefined : onToggle}
        className="flex w-full items-center gap-2 rounded-lg px-2 py-2 text-left hover:bg-surface-2"
      >
        {forceOpen ? <span className="w-4" /> : open ? <ChevronDown className="h-4 w-4 text-muted" /> : <ChevronRight className="h-4 w-4 text-muted" />}
        <div className="flex min-w-0 flex-1 items-center gap-1.5">
          <TeamLogo teamId={game.away.teamId} name={game.away.teamName} size={18} />
          <span className="text-xs font-medium text-muted">@</span>
          <TeamLogo teamId={game.home.teamId} name={game.home.teamName} size={18} />
          <span className="ml-1 truncate text-xs font-semibold">
            {abbrTeam(game.away.teamName)} @ {abbrTeam(game.home.teamName)}
          </span>
        </div>
        {isLive ? (
          <Circle className="h-2 w-2 animate-pulse fill-[var(--negative)] text-[var(--negative)]" />
        ) : (
          <span className="text-[10px] text-muted-2">{game.players.length}</span>
        )}
      </button>

      {open && (
        <div className="ml-4 border-l border-border pl-1">
          {players.map((p) => (
            <button
              key={`${p.gamePk}-${p.id}`}
              onClick={() => onSelect(p)}
              className={cn(
                "flex w-full items-center gap-2 rounded-lg px-2 py-1.5 text-left transition-colors",
                selectedId === p.id ? "bg-brand-500/15 text-brand-500" : "hover:bg-surface-2",
              )}
            >
              <span className="w-5 text-center text-[10px] font-semibold text-muted-2">
                {p.isPitcher ? "P" : p.battingOrder ?? "-"}
              </span>
              <span className="min-w-0 flex-1 truncate text-sm">{p.name}</span>
              <span className="text-[10px] text-muted-2">{p.position}</span>
            </button>
          ))}
          {players.length === 0 && <p className="px-2 py-1.5 text-xs text-muted-2">No players.</p>}
        </div>
      )}
    </div>
  );
}

function abbrTeam(name: string) {
  const parts = name.split(" ");
  return parts[parts.length - 1].slice(0, 3).toUpperCase();
}
