"use client";

import { useMemo } from "react";
import { useQuery } from "@tanstack/react-query";
import { X, Save, Download, Trash2, Layers, Link2, AlertTriangle, Loader2 } from "lucide-react";
import { cn, pct, formatSigned, formatAmerican } from "@/lib/utils";
import { useWorkspace, WORKSPACE_MAX, type WorkspaceEntry } from "./workspace-store";
import type { AnalysisPayload } from "@/lib/mlb/analysis";

export function AnalysisWorkspace() {
  const ws = useWorkspace();

  const sharedContext = useMemo(() => detectShared(ws.entries), [ws.entries]);

  function exportJson() {
    const blob = new Blob([JSON.stringify({ savedAt: new Date().toISOString(), entries: ws.entries }, null, 2)], {
      type: "application/json",
    });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = `diamond-analysis-${Date.now()}.json`;
    a.click();
    URL.revokeObjectURL(url);
  }

  function save() {
    try {
      const key = "diamond-saved-analyses-v1";
      const prev = JSON.parse(localStorage.getItem(key) ?? "[]");
      prev.push({ savedAt: new Date().toISOString(), entries: ws.entries });
      localStorage.setItem(key, JSON.stringify(prev));
    } catch {
      /* ignore */
    }
  }

  return (
    <div className="glass flex h-full flex-col rounded-2xl">
      <div className="flex items-center gap-2 border-b border-border p-4">
        <Layers className="h-4 w-4 text-brand-500" />
        <h2 className="text-sm font-bold">Analysis Workspace</h2>
        <span className="ml-auto text-xs text-muted">
          {ws.entries.length}/{WORKSPACE_MAX}
        </span>
      </div>

      <div className="min-h-0 flex-1 overflow-y-auto p-3">
        {ws.entries.length === 0 ? (
          <div className="grid h-full place-items-center p-6 text-center">
            <div>
              <Layers className="mx-auto h-8 w-8 text-muted-2" />
              <p className="mt-3 text-sm font-medium">No players selected</p>
              <p className="mt-1 text-xs text-muted">
                Add up to {WORKSPACE_MAX} players with the Over / Under buttons to compare projections,
                edge, and expected value.
              </p>
            </div>
          </div>
        ) : (
          <div className="space-y-3">
            {sharedContext.length > 0 && (
              <div className="rounded-xl border border-brand-500/25 bg-brand-500/8 p-3">
                <div className="flex items-center gap-1.5 text-xs font-semibold text-brand-500">
                  <Link2 className="h-3.5 w-3.5" /> Shared context
                </div>
                <ul className="mt-1.5 space-y-0.5 text-xs text-muted">
                  {sharedContext.map((s) => (
                    <li key={s}>• {s}</li>
                  ))}
                </ul>
                <p className="mt-1.5 text-[11px] text-muted-2">
                  Outcomes may be correlated. This tool does not compute parlay payouts.
                </p>
              </div>
            )}

            {ws.entries.map((e) => (
              <EntryCard key={`${e.playerId}:${e.market}`} entry={e} />
            ))}
          </div>
        )}
      </div>

      {ws.entries.length > 0 && (
        <div className="grid grid-cols-3 gap-2 border-t border-border p-3">
          <button onClick={save} className="flex items-center justify-center gap-1 rounded-lg bg-surface-2 py-2 text-xs font-medium hover:bg-surface-2/70">
            <Save className="h-3.5 w-3.5" /> Save
          </button>
          <button onClick={exportJson} className="flex items-center justify-center gap-1 rounded-lg bg-surface-2 py-2 text-xs font-medium hover:bg-surface-2/70">
            <Download className="h-3.5 w-3.5" /> Export
          </button>
          <button onClick={ws.clear} className="flex items-center justify-center gap-1 rounded-lg bg-[var(--negative)]/12 py-2 text-xs font-medium text-[var(--negative)] hover:bg-[var(--negative)]/20">
            <Trash2 className="h-3.5 w-3.5" /> Clear
          </button>
        </div>
      )}
    </div>
  );
}

function EntryCard({ entry }: { entry: WorkspaceEntry }) {
  const ws = useWorkspace();
  const odds = entry.side === "over" ? entry.overOdds : entry.underOdds;

  const qs = new URLSearchParams({
    prop: entry.market,
    line: String(entry.line),
    side: entry.side,
    over: entry.overOdds,
    under: entry.underOdds,
  });
  const { data, isLoading } = useQuery({
    queryKey: ["ws-analysis", entry.playerId, entry.market, entry.line, entry.overOdds, entry.underOdds],
    queryFn: async () =>
      (await fetch(`/api/players/${entry.playerId}/analysis?${qs}`)).json() as Promise<AnalysisPayload>,
  });

  const a = data?.analysis;
  const edge = entry.side === "over" ? a?.recommendation.over : a?.recommendation.under;
  const modelProb = entry.side === "over" ? a?.simulation.probOver : a?.simulation.probUnder;

  return (
    <div className="rounded-xl border border-border bg-surface-2/40 p-3">
      <div className="flex items-center gap-2">
        <span
          className={cn(
            "rounded px-1.5 py-0.5 text-[10px] font-bold uppercase",
            entry.side === "over" ? "bg-[var(--positive)]/15 text-[var(--positive)]" : "bg-[var(--negative)]/15 text-[var(--negative)]",
          )}
        >
          {entry.side} {entry.line}
        </span>
        <span className="min-w-0 flex-1 truncate text-sm font-semibold">{entry.name}</span>
        <button onClick={() => ws.remove(entry.playerId, entry.market)} className="text-muted hover:text-[var(--negative)]">
          <X className="h-4 w-4" />
        </button>
      </div>
      <div className="mt-0.5 text-xs text-muted">{entry.marketLabel}</div>

      {isLoading ? (
        <div className="mt-2 flex items-center gap-2 text-xs text-muted">
          <Loader2 className="h-3 w-3 animate-spin" /> Analyzing…
        </div>
      ) : a && edge ? (
        <>
          <div className="mt-2 grid grid-cols-2 gap-x-3 gap-y-1 text-xs">
            <Metric label="Projection" value={a.projection.lambda.toFixed(2)} />
            <Metric label="Model prob" value={pct(modelProb ?? 0)} />
            <Metric label="Fair prob" value={pct(edge.modelProb)} />
            <Metric label="Fair odds" value={formatAmerican(edge.fairAmerican)} />
            <Metric label="Entered" value={formatAmerican(Number(odds))} muted />
            <Metric label="Edge" value={pct(edge.edge)} tone={edge.edge > 0 ? "pos" : "neg"} />
            <Metric label="EV" value={formatSigned(edge.ev * 100) + "%"} tone={edge.ev > 0 ? "pos" : "neg"} />
            <Metric label="Model confidence" value={`${a.recommendation.confidence}/100`} />
          </div>
          <div className="mt-2 flex flex-wrap items-center gap-1.5">
            <span className={cn("rounded px-1.5 py-0.5 text-[10px] font-medium", dqTone(data.dataQuality?.score ?? 0))}>
              DQ {data.dataQuality?.score ?? "—"}
            </span>
            <span className="text-[10px] text-muted-2">Odds user-entered</span>
            {data.warnings.slice(0, 1).map((w) => (
              <span key={w.code} className="flex items-center gap-1 text-[10px] text-[var(--warning)]">
                <AlertTriangle className="h-2.5 w-2.5" /> {w.code.replace(/_/g, " ")}
              </span>
            ))}
          </div>
          {/* Editable side + odds */}
          <div className="mt-2 flex items-center gap-2">
            <div className="flex rounded-lg border border-border bg-surface p-0.5 text-[10px]">
              {(["over", "under"] as const).map((s) => (
                <button
                  key={s}
                  onClick={() => ws.update(entry.playerId, entry.market, { side: s })}
                  className={cn("rounded px-2 py-0.5 font-medium capitalize", entry.side === s ? "bg-brand-500 text-white" : "text-muted")}
                >
                  {s}
                </button>
              ))}
            </div>
            <input
              value={odds}
              onChange={(e) =>
                ws.update(entry.playerId, entry.market, entry.side === "over" ? { overOdds: e.target.value } : { underOdds: e.target.value })
              }
              className="h-6 w-16 rounded border border-border bg-surface px-1 text-center text-[11px] tabular-nums outline-none"
            />
          </div>
        </>
      ) : (
        <p className="mt-2 text-xs text-muted">No analysis available (insufficient data).</p>
      )}
    </div>
  );
}

function Metric({ label, value, tone, muted }: { label: string; value: string; tone?: "pos" | "neg"; muted?: boolean }) {
  return (
    <div className="flex items-center justify-between">
      <span className="text-muted">{label}</span>
      <span
        className={cn(
          "font-semibold tabular-nums",
          tone === "pos" && "text-[var(--positive)]",
          tone === "neg" && "text-[var(--negative)]",
          muted && "text-muted-2",
        )}
      >
        {value}
      </span>
    </div>
  );
}

function dqTone(score: number) {
  return score >= 70
    ? "bg-[var(--positive)]/12 text-[var(--positive)]"
    : score >= 45
      ? "bg-[var(--warning)]/12 text-[var(--warning)]"
      : "bg-[var(--negative)]/12 text-[var(--negative)]";
}

function detectShared(entries: WorkspaceEntry[]): string[] {
  const out: string[] = [];
  if (entries.length < 2) return out;
  const games = new Map<number, WorkspaceEntry[]>();
  const teams = new Map<number, WorkspaceEntry[]>();
  for (const e of entries) {
    (games.get(e.gamePk) ?? games.set(e.gamePk, []).get(e.gamePk)!).push(e);
    (teams.get(e.teamId) ?? teams.set(e.teamId, []).get(e.teamId)!).push(e);
  }
  for (const [, es] of games) if (es.length > 1) out.push(`${es.length} players in the same game (${es[0].teamName} vs ${abbr(es[0].opponentName)})`);
  for (const [, es] of teams) if (es.length > 1) out.push(`${es.length} players on ${es[0].teamName}`);
  return out;
}

function abbr(name?: string) {
  if (!name) return "—";
  const p = name.split(" ");
  return p[p.length - 1];
}
