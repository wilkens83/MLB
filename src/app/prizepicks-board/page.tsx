"use client";

import { Suspense, useCallback, useEffect, useMemo, useState } from "react";
import { useSearchParams, useRouter, usePathname } from "next/navigation";
import { ChevronLeft, ChevronRight, Upload, RefreshCw, Loader2, ClipboardList, AlertCircle } from "lucide-react";
import { ImportPanel } from "@/components/prizepicks/import-panel";
import { CandidateCard } from "@/components/prizepicks/candidate-card";
import { allMarkets } from "@/lib/prizepicks/market-map";
import * as store from "@/lib/prizepicks/store";
import { cn } from "@/lib/utils";
import type { PrizePicksBoardEntry } from "@/lib/prizepicks/types";
import type { CandidateEvaluation } from "@/lib/prizepicks/types";
import type { RankingResult } from "@/lib/prizepicks/ranking";
import type { PlayerCandidate, PrizePicksPlayerResolution } from "@/lib/prizepicks/types";

const MARKETS = allMarkets();

function todayIso() {
  return new Date().toISOString().slice(0, 10);
}
function addDays(iso: string, n: number) {
  const d = new Date(iso + "T12:00:00Z");
  d.setUTCDate(d.getUTCDate() + n);
  return d.toISOString().slice(0, 10);
}

interface EvalState {
  evaluation: CandidateEvaluation | null;
  ranking: RankingResult | null;
}

function BoardInner() {
  const sp = useSearchParams();
  const router = useRouter();
  const pathname = usePathname();

  const date = sp.get("date") || todayIso();
  const market = sp.get("market") || "all";
  const direction = sp.get("dir") || "all";

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

  const [entries, setEntries] = useState<PrizePicksBoardEntry[]>([]);
  const [evals, setEvals] = useState<Record<string, EvalState>>({});
  const [importing, setImporting] = useState(false);
  const [working, setWorking] = useState(false);

  // Load persisted board for the date (client-only store).
  useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect
    setEntries(store.loadBoard(date));
    setEvals({});
  }, [date]);

  const unresolvedCount = entries.filter((e) => e.status === "unresolved" || e.status === "ambiguous").length;

  async function resolveAndAnalyze() {
    setWorking(true);
    try {
      // 1) Resolve players/games for entries that aren't resolved yet.
      let current = store.loadBoard(date);
      for (const e of current) {
        if (e.status !== "unresolved" || e.mlbPlayerId) continue;
        const cat = MARKETS.find((m) => m.canonical === e.marketKey)?.category;
        const params = new URLSearchParams({ name: e.rawPlayerName, date, ...(e.teamAbbreviation ? { team: e.teamAbbreviation } : {}), ...(cat ? { category: cat } : {}) });
        const res = (await fetch(`/api/prizepicks/resolve?${params}`).then((r) => r.json())) as PrizePicksPlayerResolution;
        if (res.status === "resolved" && res.chosen) {
          const c: PlayerCandidate = res.chosen;
          current = store.updateEntry(date, e.id, {
            mlbPlayerId: c.mlbPlayerId, gamePk: c.gamePk, mlbTeamId: c.teamId,
            position: c.position, resolvedTeamName: c.teamName, opponentName: c.opponentName,
            status: "resolved",
          });
        } else if (res.status === "ambiguous" || res.status === "conflicting") {
          current = store.updateEntry(date, e.id, { status: "ambiguous", notes: res.reason });
        } else {
          current = store.updateEntry(date, e.id, { status: "invalid", notes: res.reason });
        }
      }
      setEntries(current);

      // 2) Evaluate resolved + supported entries through the existing engine.
      const toEval = current.filter((e) => e.status === "resolved" && e.mlbPlayerId && e.marketSupported);
      if (toEval.length) {
        const body = {
          entries: toEval.map((e) => ({ entryId: e.id, mlbPlayerId: e.mlbPlayerId!, marketKey: e.marketKey, line: e.line, gamePk: e.gamePk, lineCapturedAt: e.capturedAt })),
        };
        const out = (await fetch("/api/prizepicks/evaluate", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) }).then((r) => r.json())) as {
          results: { entryId: string; evaluation: CandidateEvaluation | null; ranking: RankingResult | null }[];
        };
        const map: Record<string, EvalState> = {};
        for (const r of out.results ?? []) map[r.entryId] = { evaluation: r.evaluation, ranking: r.ranking };
        setEvals((prev) => ({ ...prev, ...map }));
      }
    } finally {
      setWorking(false);
    }
  }

  function handleImport(incoming: PrizePicksBoardEntry[]) {
    const merged = store.addEntries(date, incoming);
    setEntries(merged);
    setImporting(false);
    // auto-resolve+analyze after a tick
    setTimeout(() => void resolveAndAnalyze(), 50);
  }

  function editLine(entry: PrizePicksBoardEntry) {
    const v = window.prompt(`New line for ${entry.rawPlayerName} (${entry.rawMarketLabel})`, String(entry.line));
    if (v === null) return;
    const n = Number(v);
    if (!Number.isFinite(n)) return;
    const next = store.updateEntry(date, entry.id, { line: n, capturedAt: new Date().toISOString() }, "manual");
    setEntries(next);
    setEvals((p) => ({ ...p, [entry.id]: { evaluation: null, ranking: null } }));
    setTimeout(() => void resolveAndAnalyze(), 50);
  }

  function archive(entry: PrizePicksBoardEntry) {
    setEntries(store.archiveEntry(date, entry.id));
  }

  const visible = useMemo(() => {
    return entries
      .filter((e) => e.status !== "archived")
      .filter((e) => (market === "all" ? true : e.marketKey === market))
      .filter((e) => {
        if (direction === "all") return true;
        const r = evals[e.id]?.ranking;
        return r?.direction === direction;
      })
      .sort((a, b) => (evals[b.id]?.ranking?.score ?? -1) - (evals[a.id]?.ranking?.score ?? -1));
  }, [entries, market, direction, evals]);

  return (
    <div className="space-y-4">
      {importing && <ImportPanel boardDate={date} onImport={handleImport} onClose={() => setImporting(false)} />}

      {/* Header */}
      <div className="panel flex flex-wrap items-center gap-2 p-3">
        <ClipboardList className="h-5 w-5 text-brand-500" />
        <div className="mr-2">
          <div className="text-sm font-bold leading-tight">PrizePicks Board</div>
          <div className="text-[11px] text-muted">{entries.filter((e) => e.status !== "archived").length} entries · imported by you</div>
        </div>
        <div className="flex items-center gap-1">
          <button onClick={() => setParam({ date: addDays(date, -1) })} className="grid h-8 w-8 place-items-center rounded-lg border border-border hover:bg-surface-hover" aria-label="Previous day"><ChevronLeft className="h-4 w-4" /></button>
          <input type="date" value={date} onChange={(e) => setParam({ date: e.target.value })} className="h-8 rounded-lg border border-border bg-surface px-2 text-sm outline-none" />
          <button onClick={() => setParam({ date: todayIso() })} className="h-8 rounded-lg border border-border px-2 text-xs hover:bg-surface-hover">Today</button>
          <button onClick={() => setParam({ date: addDays(date, 1) })} className="grid h-8 w-8 place-items-center rounded-lg border border-border hover:bg-surface-hover" aria-label="Next day"><ChevronRight className="h-4 w-4" /></button>
        </div>
        <div className="ml-auto flex items-center gap-2">
          {unresolvedCount > 0 && (
            <span className="inline-flex items-center gap-1 rounded-md border border-[var(--warning)]/30 bg-[var(--warning)]/10 px-2 py-1 text-[11px] text-[var(--warning)]">
              <AlertCircle className="h-3 w-3" /> {unresolvedCount} unresolved
            </span>
          )}
          <button onClick={() => void resolveAndAnalyze()} disabled={working || entries.length === 0} className="inline-flex items-center gap-1 rounded-lg border border-border px-3 py-1.5 text-xs font-medium disabled:opacity-40 hover:bg-surface-hover">
            {working ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <RefreshCw className="h-3.5 w-3.5" />} Resolve &amp; analyze
          </button>
          <button onClick={() => setImporting(true)} className="inline-flex items-center gap-1 rounded-lg bg-brand-500 px-3 py-1.5 text-xs font-semibold text-white hover:bg-brand-600">
            <Upload className="h-3.5 w-3.5" /> Import
          </button>
        </div>
      </div>

      {/* Market pills */}
      <div className="glass -mx-1 rounded-2xl px-1 py-2">
        <div className="flex gap-1.5 overflow-x-auto pb-1">
          <Pill active={market === "all"} label="All markets" onClick={() => setParam({ market: null })} />
          {MARKETS.filter((m) => m.supported).map((m) => (
            <Pill key={m.canonical} active={market === m.canonical} label={m.label} onClick={() => setParam({ market: m.canonical })} />
          ))}
        </div>
      </div>

      {/* Direction filter */}
      <div className="flex items-center gap-2 text-xs">
        <span className="text-muted">Direction:</span>
        {[["all", "All"], ["more", "More"], ["less", "Less"]].map(([v, l]) => (
          <button key={v} onClick={() => setParam({ dir: v === "all" ? null : v })} className={cn("rounded-md border px-2 py-1 font-medium", direction === v ? "border-brand-500 bg-brand-500/10 text-brand-500" : "border-border text-muted hover:text-foreground")}>{l}</button>
        ))}
      </div>

      {/* Cards */}
      {entries.filter((e) => e.status !== "archived").length === 0 ? (
        <EmptyState onImport={() => setImporting(true)} />
      ) : visible.length === 0 ? (
        <div className="panel p-8 text-center text-sm text-muted">No entries match this filter.</div>
      ) : (
        <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-3">
          {visible.map((e) => (
            <CandidateCard
              key={e.id}
              entry={e}
              evaluation={evals[e.id]?.evaluation}
              ranking={evals[e.id]?.ranking}
              loading={working && !evals[e.id]}
              onEditLine={editLine}
              onArchive={archive}
            />
          ))}
        </div>
      )}
    </div>
  );
}

function Pill({ active, label, onClick }: { active: boolean; label: string; onClick: () => void }) {
  return (
    <button onClick={onClick} className={cn("whitespace-nowrap rounded-full px-3 py-1.5 text-sm font-medium transition-colors", active ? "bg-brand-500 text-white" : "bg-surface-2 text-muted hover:text-foreground")}>
      {label}
    </button>
  );
}

function EmptyState({ onImport }: { onImport: () => void }) {
  return (
    <div className="panel grid place-items-center p-12 text-center">
      <div className="max-w-md">
        <ClipboardList className="mx-auto h-10 w-10 text-brand-500" />
        <h2 className="mt-4 text-lg font-bold">Import your PrizePicks board</h2>
        <p className="mt-1 text-sm text-muted">
          Diamond Edge does not scrape PrizePicks. Enter the players and lines you see (manual or CSV);
          each is matched to a real MLB player, connected to the scheduled game, and analyzed by the
          existing model. Imported values keep their source and capture time.
        </p>
        <button onClick={onImport} className="mt-4 inline-flex items-center gap-1 rounded-lg bg-brand-500 px-4 py-2 text-sm font-semibold text-white hover:bg-brand-600">
          <Upload className="h-4 w-4" /> Import board
        </button>
      </div>
    </div>
  );
}

export default function PrizePicksBoardPage() {
  return (
    <Suspense fallback={<div className="grid h-64 place-items-center"><Loader2 className="h-6 w-6 animate-spin text-brand-500" /></div>}>
      <BoardInner />
    </Suspense>
  );
}
