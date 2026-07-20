"use client";

import { useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { LayoutGrid, Loader2, ChevronLeft } from "lucide-react";
import { SlateSidebar } from "@/components/slate/slate-sidebar";
import { PlayerWorkbench, type WorkbenchContext } from "@/components/slate/player-workbench";
import { Skeleton } from "@/components/ui/primitives";
import { cn } from "@/lib/utils";
import type { Slate, SlatePlayer } from "@/lib/mlb/slate";

export default function SlatePage() {
  const [selected, setSelected] = useState<SlatePlayer | null>(null);
  const [mobileSidebar, setMobileSidebar] = useState(true);

  const { data, isLoading, isError } = useQuery({
    queryKey: ["slate"],
    queryFn: async () => (await fetch("/api/slate")).json() as Promise<Slate>,
    staleTime: 60_000,
  });

  function select(p: SlatePlayer) {
    setSelected(p);
    setMobileSidebar(false);
  }

  const ctx: WorkbenchContext | undefined = selected
    ? {
        teamId: selected.teamId,
        teamName: selected.teamName,
        opponentId: selected.opponentId,
        opponentName: selected.opponentName,
        venueName: selected.venueName,
        position: selected.position,
        battingOrder: selected.battingOrder,
        lineupStatus: selected.lineupStatus,
      }
    : undefined;

  return (
    <div className="grid gap-5 lg:grid-cols-[320px_1fr]">
      {/* Sidebar */}
      <aside
        className={cn(
          "glass h-[calc(100vh-9rem)] overflow-hidden rounded-2xl lg:sticky lg:top-24",
          !mobileSidebar && "hidden lg:block",
        )}
      >
        <div className="flex items-center gap-2 border-b border-border p-3">
          <LayoutGrid className="h-4 w-4 text-brand-500" />
          <h2 className="text-sm font-bold">Today&apos;s Slate</h2>
          {data && <span className="ml-auto text-xs text-muted">{data.games.length} games</span>}
        </div>
        {isLoading && (
          <div className="space-y-2 p-3">
            {Array.from({ length: 8 }).map((_, i) => (
              <Skeleton key={i} className="h-9" />
            ))}
          </div>
        )}
        {isError && <p className="p-4 text-sm text-[var(--negative)]">Failed to load the slate.</p>}
        {data && <SlateSidebar slate={data} selectedId={selected?.id} onSelect={select} />}
      </aside>

      {/* Workbench */}
      <section className="min-w-0">
        {selected && (
          <button
            onClick={() => setMobileSidebar(true)}
            className="mb-3 inline-flex items-center gap-1 text-sm text-muted hover:text-foreground lg:hidden"
          >
            <ChevronLeft className="h-4 w-4" /> Slate
          </button>
        )}
        {selected ? (
          <PlayerWorkbench
            key={selected.id}
            playerId={selected.id}
            isPitcher={selected.isPitcher}
            context={ctx}
          />
        ) : (
          <EmptyState loading={isLoading} />
        )}
      </section>
    </div>
  );
}

function EmptyState({ loading }: { loading: boolean }) {
  return (
    <div className="glass grid h-[60vh] place-items-center rounded-2xl p-8 text-center">
      <div>
        {loading ? (
          <Loader2 className="mx-auto h-8 w-8 animate-spin text-brand-500" />
        ) : (
          <LayoutGrid className="mx-auto h-10 w-10 text-brand-500" />
        )}
        <h2 className="mt-4 text-lg font-bold">Select a player</h2>
        <p className="mt-1 max-w-sm text-sm text-muted">
          Pick any pitcher or hitter from today&apos;s slate to load their full analytics workbench —
          projections, Statcast, splits, matchup, game logs, and simulation.
        </p>
      </div>
    </div>
  );
}
