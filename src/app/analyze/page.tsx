"use client";

import { Suspense, useCallback } from "react";
import { useSearchParams, useRouter, usePathname } from "next/navigation";
import { useQuery } from "@tanstack/react-query";
import { ChevronLeft, ChevronRight, SlidersHorizontal, Search, Loader2 } from "lucide-react";
import { WorkspaceProvider } from "@/components/analyze/workspace-store";
import { AnalysisWorkspace } from "@/components/analyze/analysis-workspace";
import { GameGroup, type CardFilters } from "@/components/analyze/game-group";
import { MARKETS, POPULAR_MARKETS } from "@/lib/props/markets";
import { Skeleton } from "@/components/ui/primitives";
import { cn } from "@/lib/utils";
import type { Slate } from "@/lib/mlb/slate";

function todayIso() {
  return new Date().toISOString().slice(0, 10);
}
function addDays(iso: string, n: number) {
  const d = new Date(iso + "T12:00:00Z");
  d.setUTCDate(d.getUTCDate() + n);
  return d.toISOString().slice(0, 10);
}

function AnalyzeInner() {
  const sp = useSearchParams();
  const router = useRouter();
  const pathname = usePathname();

  const date = sp.get("date") || todayIso();
  const market = sp.get("market") || "hits";
  const role = (sp.get("role") as CardFilters["role"]) || "all";
  const home = (sp.get("home") as CardFilters["home"]) || "all";
  const search = sp.get("q") || "";
  const minDataQuality = Number(sp.get("minDq")) || 0;
  const minProjection = Number(sp.get("minProj")) || 0;

  const setParam = useCallback(
    (patch: Record<string, string | null>) => {
      const next = new URLSearchParams(sp.toString());
      for (const [k, v] of Object.entries(patch)) {
        if (v === null || v === "") next.delete(k);
        else next.set(k, v);
      }
      router.replace(`${pathname}?${next.toString()}`, { scroll: false });
    },
    [sp, router, pathname],
  );

  const filters: CardFilters = { role, minDataQuality, minProjection, search, home };

  const { data: slate, isLoading } = useQuery({
    queryKey: ["slate", date],
    queryFn: async () => (await fetch(`/api/slate?date=${date}`)).json() as Promise<Slate>,
    staleTime: 60_000,
  });

  const games = slate?.games ?? [];

  return (
    <div className="space-y-4">
      {/* Market pills */}
      <div className="glass sticky top-16 z-30 -mx-1 rounded-2xl px-1 py-2">
        <div className="flex gap-1.5 overflow-x-auto pb-1">
          <Pill active={POPULAR_MARKETS.includes(market)} label="Popular" onClick={() => setParam({ market: "hits" })} />
          {MARKETS.map((m) => (
            <Pill key={m.key} active={market === m.key} label={m.label} onClick={() => setParam({ market: m.key })} />
          ))}
        </div>
      </div>

      {/* Date + filters */}
      <div className="glass flex flex-wrap items-center gap-2 rounded-2xl p-3">
        <div className="flex items-center gap-1">
          <IconBtn onClick={() => setParam({ date: addDays(date, -1) })} aria-label="Previous day">
            <ChevronLeft className="h-4 w-4" />
          </IconBtn>
          <input
            type="date"
            value={date}
            onChange={(e) => setParam({ date: e.target.value })}
            className="h-9 rounded-lg border border-border bg-surface px-2 text-sm outline-none"
          />
          <button onClick={() => setParam({ date: todayIso() })} className="h-9 rounded-lg border border-border bg-surface px-3 text-xs font-medium hover:bg-surface-2">
            Today
          </button>
          <IconBtn onClick={() => setParam({ date: addDays(date, 1) })} aria-label="Next day">
            <ChevronRight className="h-4 w-4" />
          </IconBtn>
        </div>

        <div className="flex items-center gap-2 rounded-lg border border-border bg-surface px-2 h-9">
          <Search className="h-3.5 w-3.5 text-muted" />
          <input
            value={search}
            onChange={(e) => setParam({ q: e.target.value })}
            placeholder="Player / team"
            className="w-32 bg-transparent text-sm outline-none placeholder:text-muted-2"
          />
        </div>

        <Segmented value={role} onChange={(v) => setParam({ role: v })} options={[["all", "All"], ["batters", "Batters"], ["pitchers", "Pitchers"]]} />
        <Segmented value={home} onChange={(v) => setParam({ home: v })} options={[["all", "H/A"], ["home", "Home"], ["away", "Away"]]} />

        <label className="flex items-center gap-1.5 text-xs text-muted">
          <SlidersHorizontal className="h-3.5 w-3.5" /> Min DQ
          <input
            type="number"
            min={0}
            max={100}
            value={minDataQuality || ""}
            onChange={(e) => setParam({ minDq: e.target.value })}
            className="h-9 w-16 rounded-lg border border-border bg-surface px-2 text-center text-sm outline-none"
            placeholder="0"
          />
        </label>
        <label className="flex items-center gap-1.5 text-xs text-muted">
          Min proj
          <input
            type="number"
            step="0.5"
            value={minProjection || ""}
            onChange={(e) => setParam({ minProj: e.target.value })}
            className="h-9 w-16 rounded-lg border border-border bg-surface px-2 text-center text-sm outline-none"
            placeholder="0"
          />
        </label>
      </div>

      {/* Content grid */}
      <div className="grid gap-4 lg:grid-cols-[1fr_360px]">
        <div className="space-y-3">
          {isLoading ? (
            Array.from({ length: 4 }).map((_, i) => <Skeleton key={i} className="h-20 rounded-2xl" />)
          ) : games.length === 0 ? (
            <div className="glass rounded-2xl p-10 text-center text-muted">
              No games scheduled for {date}.
            </div>
          ) : (
            games.map((g, i) => (
              <GameGroup key={g.gamePk} game={g} market={market} date={date} defaultOpen={i === 0} filters={filters} />
            ))
          )}
        </div>

        <div className="lg:sticky lg:top-32 lg:h-[calc(100vh-9rem)]">
          <AnalysisWorkspace />
        </div>
      </div>
    </div>
  );
}

function Pill({ active, label, onClick }: { active: boolean; label: string; onClick: () => void }) {
  return (
    <button
      onClick={onClick}
      className={cn(
        "whitespace-nowrap rounded-full px-3 py-1.5 text-sm font-medium transition-colors",
        active ? "bg-brand-500 text-white" : "bg-surface-2 text-muted hover:text-foreground",
      )}
    >
      {label}
    </button>
  );
}

function IconBtn({ children, onClick, ...rest }: { children: React.ReactNode; onClick: () => void } & React.HTMLAttributes<HTMLButtonElement>) {
  return (
    <button onClick={onClick} className="grid h-9 w-9 place-items-center rounded-lg border border-border bg-surface hover:bg-surface-2" {...rest}>
      {children}
    </button>
  );
}

function Segmented({ value, onChange, options }: { value: string; onChange: (v: string) => void; options: [string, string][] }) {
  return (
    <div className="flex h-9 rounded-lg border border-border bg-surface p-0.5">
      {options.map(([val, label]) => (
        <button
          key={val}
          onClick={() => onChange(val)}
          className={cn("rounded-md px-2.5 text-xs font-medium", value === val ? "bg-brand-500 text-white" : "text-muted hover:text-foreground")}
        >
          {label}
        </button>
      ))}
    </div>
  );
}

export default function AnalyzePage() {
  return (
    <WorkspaceProvider>
      <Suspense fallback={<div className="grid h-64 place-items-center"><Loader2 className="h-6 w-6 animate-spin text-brand-500" /></div>}>
        <AnalyzeInner />
      </Suspense>
    </WorkspaceProvider>
  );
}
