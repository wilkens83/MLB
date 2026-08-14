"use client";

import { useEffect, useMemo, useState } from "react";
import Link from "next/link";
import { ChevronLeft, ChevronRight, Circle, Loader2, ExternalLink, CalendarDays } from "lucide-react";
import { TeamLogo } from "@/components/team-logo";
import { cn } from "@/lib/utils";
import { toScoreboardGame, sortScoreboardGames, type ScoreboardGame, type BaseState } from "@/lib/mlb/scoreboard";
import type { MlbGame } from "@/lib/mlb/types";

/* ---- pure date helpers (noon-UTC anchored → no timezone rollover) ---- */
function isoOf(d: Date): string {
  return d.toISOString().slice(0, 10);
}
function shiftIso(iso: string, days: number): string {
  const d = new Date(`${iso}T12:00:00Z`);
  d.setUTCDate(d.getUTCDate() + days);
  return isoOf(d);
}
function stripDays(centerIso: string): { iso: string; weekday: string; monthDay: string }[] {
  return [-3, -2, -1, 0, 1, 2, 3].map((offset) => {
    const iso = shiftIso(centerIso, offset);
    const d = new Date(`${iso}T12:00:00Z`);
    return {
      iso,
      weekday: d.toLocaleDateString("en-US", { weekday: "short", timeZone: "UTC" }).toUpperCase(),
      monthDay: d.toLocaleDateString("en-US", { month: "short", day: "numeric", timeZone: "UTC" }).toUpperCase(),
    };
  });
}
function longDate(iso: string): string {
  return new Date(`${iso}T12:00:00Z`).toLocaleDateString("en-US", {
    weekday: "long", year: "numeric", month: "long", day: "numeric", timeZone: "UTC",
  });
}

interface LoadState { games: ScoreboardGame[] | null; error: string | null }

export function ScoreboardDashboard({ initialDate }: { initialDate: string }) {
  const [date, setDate] = useState(initialDate);
  // `loadedDate` advances only inside the async continuation, so `loading` is
  // derived (never set synchronously in an effect).
  const [loadedDate, setLoadedDate] = useState<string | null>(null);
  const [result, setResult] = useState<LoadState>({ games: null, error: null });
  const loading = loadedDate !== date;

  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const res = await fetch(`/api/games?date=${date}`, { cache: "no-store" });
        if (!res.ok) throw new Error(`status ${res.status}`);
        const data = (await res.json()) as { games: MlbGame[] };
        if (cancelled) return;
        setResult({ games: sortScoreboardGames((data.games ?? []).map(toScoreboardGame)), error: null });
      } catch {
        if (cancelled) return;
        setResult({ games: null, error: "Unable to load MLB games right now." });
      } finally {
        if (!cancelled) setLoadedDate(date);
      }
    })();
    return () => { cancelled = true; };
  }, [date]);

  const games = result.games;
  const error = result.error;
  const days = useMemo(() => stripDays(date), [date]);

  return (
    <div className="space-y-5">
      <DateStrip days={days} selected={date} onSelect={setDate} onShift={(n) => setDate(shiftIso(date, n))} />

      <div className="flex items-center justify-between">
        <h1 className="text-lg font-semibold">{longDate(date)}</h1>
        {games && !loading && (
          <span className="text-xs text-muted">
            {games.length === 0 ? "No games" : `${games.length} game${games.length === 1 ? "" : "s"}`}
          </span>
        )}
      </div>

      {loading ? (
        <div className="flex items-center justify-center gap-2 rounded-xl border border-border bg-surface-1 py-16 text-sm text-muted">
          <Loader2 className="h-4 w-4 animate-spin" /> Loading games…
        </div>
      ) : error ? (
        <div className="rounded-xl border border-[var(--warning)]/40 bg-[var(--warning)]/10 p-6 text-center text-sm">{error}</div>
      ) : games && games.length === 0 ? (
        <div className="rounded-xl border border-dashed border-border p-10 text-center text-sm text-muted">
          No games scheduled for this date.
        </div>
      ) : (
        <div className="grid grid-cols-1 gap-3 xl:grid-cols-2">
          {games?.map((g) => <ScoreboardCard key={g.gamePk} game={g} />)}
        </div>
      )}
    </div>
  );
}

function DateStrip({
  days, selected, onSelect, onShift,
}: {
  days: { iso: string; weekday: string; monthDay: string }[];
  selected: string;
  onSelect: (iso: string) => void;
  onShift: (n: number) => void;
}) {
  return (
    <div className="flex items-center gap-1 rounded-xl border border-border bg-surface-1 p-2">
      <button aria-label="Previous day" onClick={() => onShift(-1)} className="grid h-9 w-9 shrink-0 place-items-center rounded-lg text-muted hover:bg-surface-2">
        <ChevronLeft className="h-5 w-5" />
      </button>
      <div className="flex flex-1 items-stretch justify-between gap-1 overflow-x-auto">
        {days.map((d) => {
          const active = d.iso === selected;
          return (
            <button
              key={d.iso}
              onClick={() => onSelect(d.iso)}
              className={cn(
                "flex min-w-0 flex-1 flex-col items-center rounded-lg px-2 py-1.5 text-center",
                active ? "bg-[var(--brand-500)]/15 text-[var(--brand-500)]" : "text-muted hover:bg-surface-2",
              )}
            >
              <span className={cn("text-[10px] font-medium", active && "font-bold")}>{d.weekday}</span>
              <span className={cn("text-xs", active ? "font-bold" : "text-muted-2")}>{d.monthDay}</span>
            </button>
          );
        })}
      </div>
      <button aria-label="Next day" onClick={() => onShift(1)} className="grid h-9 w-9 shrink-0 place-items-center rounded-lg text-muted hover:bg-surface-2">
        <ChevronRight className="h-5 w-5" />
      </button>
      <span className="ml-1 hidden shrink-0 place-items-center px-1 text-muted sm:grid"><CalendarDays className="h-4 w-4" /></span>
    </div>
  );
}

function ScoreboardCard({ game: g }: { game: ScoreboardGame }) {
  const showScore = g.status === "live" || g.status === "final";
  return (
    <div className="rounded-xl border border-border bg-surface-1 p-4">
      <div className="mb-3 flex items-center justify-between">
        <StatusBadge game={g} />
        {g.venue && <span className="truncate text-[11px] text-muted-2">{g.venue}</span>}
      </div>

      <div className="grid grid-cols-[1fr_auto] gap-x-4 gap-y-2">
        <TeamLine team={g.away} rhe={g.rhe.away} showScore={showScore} showRhe={showScore} isPitcherProbable={g.status === "scheduled"} />
        <TeamLine team={g.home} rhe={g.rhe.home} showScore={showScore} showRhe={showScore} isPitcherProbable={g.status === "scheduled"} />
      </div>

      {g.live && <LiveStatePanel live={g.live} />}

      <div className="mt-3 flex items-center justify-between border-t border-border pt-3">
        <span className="truncate text-xs text-muted">{g.seriesDescription ?? "Regular Season"}</span>
        <div className="flex items-center gap-2">
          <Link href={g.actions.gamecastUrl} className="rounded-md border border-border px-2.5 py-1 text-xs text-muted hover:text-foreground">Gamecast</Link>
          <a href={g.actions.mlbUrl} target="_blank" rel="noreferrer" className="flex items-center gap-1 rounded-md border border-border px-2.5 py-1 text-xs text-muted hover:text-foreground">
            MLB.com <ExternalLink className="h-3 w-3" />
          </a>
        </div>
      </div>
    </div>
  );
}

function StatusBadge({ game: g }: { game: ScoreboardGame }) {
  if (g.status === "live") {
    return (
      <span className="flex items-center gap-1.5 rounded-full bg-[var(--negative)]/15 px-2.5 py-1 text-xs font-semibold text-[var(--negative)]">
        <Circle className="h-2 w-2 animate-pulse fill-current" /> {g.statusLabel}
      </span>
    );
  }
  if (g.status === "final") return <span className="rounded-full border border-border px-2.5 py-1 text-xs font-semibold text-muted">Final</span>;
  if (g.status === "postponed" || g.status === "delayed") return <span className="rounded-full bg-[var(--warning)]/15 px-2.5 py-1 text-xs font-semibold text-[var(--warning)]">{g.statusLabel}</span>;
  return <span className="rounded-full bg-surface-2 px-2.5 py-1 text-xs font-medium text-muted">{g.statusLabel}</span>;
}

function TeamLine({
  team, rhe, showScore, showRhe, isPitcherProbable,
}: {
  team: ScoreboardGame["away"]; rhe: ScoreboardGame["rhe"]["away"]; showScore: boolean; showRhe: boolean; isPitcherProbable: boolean;
}) {
  return (
    <>
      <div className="flex min-w-0 items-center gap-2.5">
        <TeamLogo teamId={team.id} name={team.name} size={28} />
        <div className="min-w-0">
          <div className={cn("truncate text-sm font-semibold", team.isWinner && "text-[var(--brand-500)]")}>
            {team.name}
            {team.record && <span className="ml-1.5 text-[11px] font-normal text-muted-2">({team.record})</span>}
          </div>
          {isPitcherProbable && <div className="truncate text-[11px] text-muted">{team.probablePitcher ?? "TBD"}</div>}
        </div>
      </div>
      <div className="flex items-center gap-3 tabular-nums">
        {showRhe && (
          <span className="hidden gap-3 text-sm text-muted sm:flex">
            <RheCell v={rhe.hits} />
            <RheCell v={rhe.errors} />
          </span>
        )}
        {showScore && <span className={cn("w-6 text-right text-lg font-bold", team.isWinner ? "text-foreground" : "text-muted")}>{team.score ?? 0}</span>}
      </div>
    </>
  );
}

function RheCell({ v }: { v?: number }) {
  return <span className="w-4 text-right text-sm">{v ?? "–"}</span>;
}

function LiveStatePanel({ live }: { live: NonNullable<ScoreboardGame["live"]> }) {
  return (
    <div className="mt-3 flex flex-wrap items-center gap-x-5 gap-y-2 rounded-lg bg-surface-2 p-2.5">
      <BaseDiamond bases={live.bases} />
      {!live.midInning && (
        <CountDisplay balls={live.balls} strikes={live.strikes} outs={live.outs} />
      )}
      {live.midInning && live.outs !== undefined && <span className="text-xs text-muted">{live.outs} out · mid-inning</span>}
      <div className="min-w-0 flex-1 text-[11px] leading-tight">
        {live.pitcher && <div className="truncate"><span className="text-muted-2">P:</span> <span className="font-medium">{live.pitcher}</span></div>}
        {live.batter && <div className="truncate"><span className="text-muted-2">AB:</span> <span className="font-medium">{live.batter}</span></div>}
        {live.dueUp && <div className="truncate"><span className="text-muted-2">Due up:</span> {live.dueUp.join(", ")}</div>}
        {!live.pitcher && !live.batter && !live.dueUp && <div className="text-muted-2">Live game in progress</div>}
      </div>
    </div>
  );
}

/** Base occupancy diamond — filled = runner on. */
function BaseDiamond({ bases }: { bases: BaseState }) {
  const on = "fill-[var(--brand-500)] stroke-[var(--brand-500)]";
  const off = "fill-transparent stroke-muted-2";
  return (
    <svg width="34" height="34" viewBox="0 0 34 34" className="shrink-0" aria-label="base occupancy">
      {/* second (top), third (left), first (right) */}
      <rect x="12" y="3" width="10" height="10" transform="rotate(45 17 8)" className={cn("stroke-[1.5]", bases.second ? on : off)} />
      <rect x="3" y="12" width="10" height="10" transform="rotate(45 8 17)" className={cn("stroke-[1.5]", bases.third ? on : off)} />
      <rect x="21" y="12" width="10" height="10" transform="rotate(45 26 17)" className={cn("stroke-[1.5]", bases.first ? on : off)} />
    </svg>
  );
}

function CountDisplay({ balls, strikes, outs }: { balls?: number; strikes?: number; outs?: number }) {
  return (
    <div className="flex flex-col gap-0.5 text-[11px] tabular-nums">
      <span><span className="text-muted-2">B</span> {balls ?? 0}</span>
      <span><span className="text-muted-2">S</span> {strikes ?? 0}</span>
      <span><span className="text-muted-2">O</span> {outs ?? 0}</span>
    </div>
  );
}
