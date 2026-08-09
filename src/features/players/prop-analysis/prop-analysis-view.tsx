/* ============================================================================
   Player-prop research page (client container). Holds URL state (market / line /
   window), fetches the server-assembled PlayerPropAnalysisViewModel, and lays out
   the dense research experience: market tabs, player header, recent-performance
   chart, historical hit rates, game conditions, matchup, pitch types, the Diamond
   Edge model block and the canonical decision — plus a sticky research rail.

   The frontend performs NO scientific calculation; it renders the view model.
   ========================================================================== */

"use client";

import { useCallback, useMemo } from "react";
import { useRouter, useSearchParams, usePathname } from "next/navigation";
import { useQuery, keepPreviousData } from "@tanstack/react-query";
import { Loader2, Minus, Plus, Swords } from "lucide-react";
import { PlayerAvatar } from "@/components/player-avatar";
import { TeamLogo } from "@/components/team-logo";
import { Skeleton } from "@/components/ui/primitives";
import { cn } from "@/lib/utils";
import { marketsForPlayerType, defaultMarketFor } from "@/lib/players/prop-analysis/market-config";
import type { PlayerPropAnalysisViewModel } from "@/lib/players/prop-analysis/types";
import { SavePlayerButtons } from "@/features/players/save-player-buttons";
import { PerformanceChart } from "./performance-chart";
import { timeAgo } from "./format";
import {
  HeaderMetrics, HitRateWindows, ModelBlock, DecisionBlock, ConditionsRow,
  MatchupPercentiles, PitchTypeTable, SectionCard,
} from "./sections";

const WINDOWS = [5, 10, 20, 30];

export function PropAnalysisView({
  playerId,
  isPitcher,
  initialTeamId,
}: {
  playerId: number;
  isPitcher: boolean;
  initialTeamId?: number;
}) {
  const router = useRouter();
  const pathname = usePathname();
  const searchParams = useSearchParams();

  const markets = useMemo(() => marketsForPlayerType(isPitcher), [isPitcher]);
  const market = searchParams.get("market") ?? defaultMarketFor(isPitcher);
  const lineParam = searchParams.get("line");
  const window = Number(searchParams.get("window")) || 10;

  const setParam = useCallback(
    (patch: Record<string, string | null>) => {
      const next = new URLSearchParams(searchParams.toString());
      for (const [k, v] of Object.entries(patch)) {
        if (v === null) next.delete(k);
        else next.set(k, v);
      }
      router.replace(`${pathname}?${next.toString()}`, { scroll: false });
    },
    [router, pathname, searchParams],
  );

  const qs = new URLSearchParams({ market, window: String(window) });
  if (lineParam) qs.set("line", lineParam);

  const { data, isFetching, isLoading } = useQuery({
    queryKey: ["prop-analysis", playerId, market, lineParam, window],
    queryFn: async () =>
      (await fetch(`/api/players/${playerId}/prop-analysis?${qs}`)).json() as Promise<PlayerPropAnalysisViewModel>,
    placeholderData: keepPreviousData,
  });

  const vm = data;
  const line = vm?.line.value ?? Number(lineParam) ?? 5.5;
  const step = vm?.config.step ?? 0.5;

  return (
    <div className="space-y-4">
      {/* Market tabs */}
      <div className="panel overflow-x-auto">
        <div className="flex min-w-max">
          {markets.map((m) => (
            <button
              key={m.marketKey}
              onClick={() => setParam({ market: m.marketKey, line: null })}
              className={cn(
                "relative whitespace-nowrap px-3.5 py-2.5 text-sm font-medium transition-colors",
                m.marketKey === market ? "text-foreground" : "text-muted hover:text-foreground",
              )}
            >
              {m.label}
              {m.marketKey === market && <span className="absolute inset-x-2 -bottom-px h-0.5 rounded-full bg-brand-500" />}
            </button>
          ))}
        </div>
      </div>

      <div className="grid grid-cols-1 gap-4 lg:grid-cols-[minmax(0,1fr)_300px]">
        {/* Main column */}
        <div className="space-y-4">
          {/* Player header */}
          {isLoading || !vm ? (
            <Skeleton className="h-28 w-full" />
          ) : (
            <PlayerHeader vm={vm} teamId={initialTeamId} onLine={(v) => setParam({ line: String(v) })} step={step} isFetching={isFetching} />
          )}

          {/* Recent performance chart */}
          <SectionCard
            title={`Last ${window} Games`}
            right={
              <div className="flex gap-1">
                {WINDOWS.map((w) => (
                  <button
                    key={w}
                    onClick={() => setParam({ window: String(w) })}
                    className={cn("rounded-md px-2 py-0.5 text-xs font-medium", w === window ? "bg-brand-500 text-white" : "text-muted hover:text-foreground")}
                  >
                    {w}
                  </button>
                ))}
              </div>
            }
          >
            {isLoading || !vm ? (
              <Skeleton className="h-[260px] w-full" />
            ) : vm.history.length === 0 ? (
              <p className="py-10 text-center text-sm text-muted">No game-log data for this market.</p>
            ) : (
              <>
                <PerformanceChart history={vm.history} line={line} unit={vm.config.unit} />
                <Legend line={line} unit={vm.config.unit} />
                <div className="mt-3">
                  <HitRateWindows rates={vm.historicalHitRates} line={line} unit={vm.config.unit} />
                </div>
              </>
            )}
          </SectionCard>

          {/* Game conditions */}
          {vm && <ConditionsRow conditions={vm.conditions} />}

          {/* Matchup header */}
          {vm && vm.player && <MatchupHeader vm={vm} teamId={initialTeamId} />}

          {/* Percentile matchup */}
          {vm && (
            <MatchupPercentiles
              matchup={vm.matchup}
              playerLabel={vm.player?.name ?? "Player"}
              opponentLabel={vm.game?.opponentTeam ?? "Opponent"}
            />
          )}

          {/* Pitch type */}
          {vm && <PitchTypeTable pitchTypes={vm.pitchTypes} />}

          {/* Model + decision */}
          <div className="grid grid-cols-1 gap-4 xl:grid-cols-2">
            {vm ? <ModelBlock sci={vm.scientific} /> : <Skeleton className="h-64 w-full" />}
            {vm ? <DecisionBlock decision={vm.decision} /> : <Skeleton className="h-64 w-full" />}
          </div>

          {/* Provenance */}
          {vm && <ProvenanceBar vm={vm} />}
        </div>

        {/* Research rail */}
        <aside className="lg:sticky lg:top-4 lg:self-start">
          {vm ? <FilterRail vm={vm} season={String(vm.provenance.season)} window={window} onWindow={(w) => setParam({ window: String(w) })} /> : <Skeleton className="h-96 w-full" />}
        </aside>
      </div>
    </div>
  );
}

/* ------------------------------ player header ----------------------------- */

function PlayerHeader({
  vm, teamId, onLine, step, isFetching,
}: {
  vm: PlayerPropAnalysisViewModel; teamId?: number; onLine: (v: number) => void; step: number; isFetching: boolean;
}) {
  const p = vm.player;
  const side = vm.scientific?.side;
  return (
    <div className="panel p-4">
      <div className="flex flex-wrap items-start gap-4">
        <PlayerAvatar playerId={p?.id ?? 0} name={p?.name ?? "Player"} teamId={teamId} size="lg" shape="rounded" className="h-16 w-16" />
        <div className="min-w-0 flex-1">
          <div className="flex items-center gap-2">
            <h1 className="truncate text-xl font-black tracking-tight">{p?.name ?? "Loading…"}</h1>
            {teamId && <TeamLogo teamId={teamId} name={p?.team ?? ""} size={22} />}
            {isFetching && <Loader2 className="h-3.5 w-3.5 animate-spin text-muted" />}
          </div>
          <div className="mt-0.5 text-xs text-muted">
            {[p?.position, p?.team, p?.bats && `Bats ${p.bats}`, p?.throws && `Throws ${p.throws}`].filter(Boolean).join(" · ")}
          </div>
          <div className="mt-2.5">
            <HeaderMetrics metrics={vm.headerMetrics} />
          </div>
        </div>

        {/* Line + side */}
        <div className="flex items-center gap-3">
          <div className="text-center">
            <div className="text-[10px] uppercase tracking-wider text-muted-2">Line</div>
            <div className="flex items-center gap-1">
              <button onClick={() => onLine(Math.max(0, +(vm.line.value - step).toFixed(1)))} className="grid h-7 w-6 place-items-center rounded-md border border-border bg-surface-2 text-muted"><Minus className="h-3 w-3" /></button>
              <span className="min-w-[3ch] text-center text-lg font-black tabular-nums">{vm.line.value}</span>
              <button onClick={() => onLine(+(vm.line.value + step).toFixed(1))} className="grid h-7 w-6 place-items-center rounded-md border border-border bg-surface-2 text-muted"><Plus className="h-3 w-3" /></button>
            </div>
            <div className="text-[10px] uppercase tracking-wider text-muted-2">{vm.config.unit}</div>
          </div>
          {side && (
            <div className="text-center">
              <div className="text-[10px] uppercase tracking-wider text-muted-2">Model Side</div>
              <div className="rounded-lg border border-brand-500/40 bg-brand-500/10 px-3 py-1.5 text-sm font-bold text-brand-500">
                {side === "more" ? "MORE" : "LESS"}
              </div>
            </div>
          )}
          <SavePlayerButtons playerId={vm.player?.id ?? 0} size="sm" />
        </div>
      </div>

      {vm.line.source !== "default" && (
        <div className="mt-2 text-[10px] text-muted-2">
          Line source: {vm.line.source === "prizepicks" ? "PrizePicks" : "manual"}
          {vm.line.capturedAt && ` · captured ${timeAgo(vm.line.capturedAt)}`}
        </div>
      )}
    </div>
  );
}

function Legend({ line, unit }: { line: number; unit: string }) {
  return (
    <div className="mt-1 flex flex-wrap items-center justify-center gap-3 text-[11px] text-muted">
      <LegendItem color="var(--positive)" label={`Over ${line} ${unit}`} />
      <LegendItem color="var(--negative)" label={`Under ${line} ${unit}`} />
      <span className="inline-flex items-center gap-1"><span className="h-0.5 w-4" style={{ background: "var(--warning)" }} /> Line {line}</span>
      <span className="inline-flex items-center gap-1"><span className="h-3 w-3 rounded border border-dashed border-brand-500" /> Upcoming</span>
    </div>
  );
}
function LegendItem({ color, label }: { color: string; label: string }) {
  return <span className="inline-flex items-center gap-1"><span className="h-2.5 w-2.5 rounded-sm" style={{ background: color }} /> {label}</span>;
}

/* ------------------------------ matchup header ---------------------------- */

function MatchupHeader({ vm, teamId }: { vm: PlayerPropAnalysisViewModel; teamId?: number }) {
  const p = vm.player!;
  const g = vm.game;
  return (
    <div className="panel flex items-center justify-between gap-3 p-4">
      <div className="flex items-center gap-2.5">
        <PlayerAvatar playerId={p.id} name={p.name} teamId={teamId} size="sm" shape="rounded" />
        <div>
          <div className="text-sm font-bold">{p.name}</div>
          <div className="text-[11px] text-muted">{p.position} · {p.isPitcher ? (p.throws ? `${p.throws}HP` : "P") : `Bats ${p.bats ?? "?"}`}</div>
        </div>
      </div>
      <div className="flex items-center gap-1.5 text-xs font-semibold uppercase tracking-wider text-muted-2">
        <Swords className="h-3.5 w-3.5" /> vs
      </div>
      <div className="flex items-center gap-2.5 text-right">
        <div>
          <div className="text-sm font-bold">{g?.opponentTeam ?? "TBD"}</div>
          <div className="text-[11px] text-muted">
            {g?.starterConfirmed ? "Starter confirmed" : "Starter projected"} · {g?.lineupConfirmed ? "Lineup confirmed" : "Lineup projected"}
          </div>
        </div>
        {g?.opponentTeamId && <TeamLogo teamId={g.opponentTeamId} name={g.opponentTeam ?? ""} size={26} />}
      </div>
    </div>
  );
}

/* ------------------------------- filter rail ------------------------------ */

const RAIL_TABS = ["Suggested", "Opp Rankings", "Splits", "Stats"] as const;

function FilterRail({ vm, season, window, onWindow }: { vm: PlayerPropAnalysisViewModel; season: string; window: number; onWindow: (w: number) => void }) {
  return (
    <div className="panel divide-y divide-border">
      <div className="p-3">
        <div className="mb-2 text-[13px] font-bold">Filters</div>
        <div className="mb-2">
          <div className="mb-1 text-[10px] uppercase tracking-wider text-muted-2">Season</div>
          <div className="flex gap-1">
            {["2024", "2025", "2026", "All"].map((s) => (
              <span key={s} className={cn("rounded-md border px-2 py-0.5 text-xs", s === season ? "border-brand-500 bg-brand-500/10 text-brand-500" : "border-border text-muted-2")}>{s}</span>
            ))}
          </div>
        </div>
        <div>
          <div className="mb-1 text-[10px] uppercase tracking-wider text-muted-2">Games</div>
          <div className="flex gap-1">
            {WINDOWS.map((w) => (
              <button key={w} onClick={() => onWindow(w)} className={cn("rounded-md border px-2 py-0.5 text-xs", w === window ? "border-brand-500 bg-brand-500/10 text-brand-500" : "border-border text-muted-2 hover:text-foreground")}>{w}</button>
            ))}
          </div>
        </div>
      </div>

      <div className="p-3">
        <div className="mb-2 flex flex-wrap gap-1">
          {RAIL_TABS.map((t, i) => (
            <span key={t} className={cn("rounded-md px-2 py-0.5 text-[11px] font-medium", i === 0 ? "bg-surface-active text-foreground" : "text-muted-2")}>{t}</span>
          ))}
        </div>
        <div className="mb-1 text-[10px] uppercase tracking-wider text-muted-2">Suggested for {vm.config.shortLabel}</div>
        <div className="flex flex-wrap gap-1.5">
          {vm.config.suggestedFilters.map((f) => (
            <span key={f} className="rounded-md border border-border bg-surface-2 px-2 py-1 text-[11px] text-muted">{f}</span>
          ))}
        </div>
        <p className="mt-2 text-[10px] leading-relaxed text-muted-2">
          Suggested filters are derived from the market&apos;s real data axes. Applying live filters is coming to this rail.
        </p>
      </div>
    </div>
  );
}

/* ------------------------------ provenance -------------------------------- */

function ProvenanceBar({ vm }: { vm: PlayerPropAnalysisViewModel }) {
  return (
    <div className="panel flex flex-wrap items-center gap-x-4 gap-y-1 px-4 py-2 text-[10px] text-muted-2">
      <span>Data as of {timeAgo(vm.provenance.dataAsOf)}</span>
      <span>·</span>
      <span>Season {vm.provenance.season}</span>
      <span>·</span>
      <span>Model {vm.provenance.modelVersion}</span>
      <span>·</span>
      <span className="inline-flex flex-wrap gap-1.5">
        {vm.provenance.sources.map((s) => (
          <span key={s.name} className={cn(s.available ? "text-muted" : "text-muted-2 line-through")}>{s.name}</span>
        ))}
      </span>
    </div>
  );
}
