"use client";

import { useCallback, useEffect, useState } from "react";
import { Gavel, RefreshCw, Loader2, ShieldAlert, Clock, Ban, CircleCheck, HelpCircle } from "lucide-react";
import { cn, pct } from "@/lib/utils";
import type { DecisionResult, AnyDecision } from "@/lib/prizepicks/decision/types";

function todayIso() {
  return new Date().toISOString().slice(0, 10);
}
interface BoardLeg { playerName: string; marketKey?: string; rawMarketLabel?: string; line: number; mlbPlayerId?: number }
function readBoard(date: string): BoardLeg[] {
  if (typeof window === "undefined") return [];
  try {
    const raw = localStorage.getItem(`dp-prizepicks-board-${date}`);
    if (!raw) return [];
    return (JSON.parse(raw) as Record<string, unknown>[])
      .map((e) => ({
        playerName: String(e.rawPlayerName ?? ""),
        marketKey: typeof e.marketKey === "string" ? e.marketKey : undefined,
        rawMarketLabel: typeof e.rawMarketLabel === "string" ? e.rawMarketLabel : undefined,
        line: Number(e.line ?? 0),
        mlbPlayerId: typeof e.mlbPlayerId === "number" ? e.mlbPlayerId : undefined,
      }))
      .filter((e) => e.playerName && Number.isFinite(e.line));
  } catch {
    return [];
  }
}

const STYLE: Record<AnyDecision, { bg: string; label: string }> = {
  APPROVE_ENTRY: { bg: "bg-[var(--positive)] text-white", label: "APPROVE ENTRY" },
  BET_MORE: { bg: "bg-[var(--positive)] text-white", label: "BET MORE" },
  BET_LESS: { bg: "bg-[var(--positive)] text-white", label: "BET LESS" },
  WAIT: { bg: "bg-[var(--warning)] text-black", label: "WAIT" },
  NO_BET: { bg: "bg-[var(--negative)] text-white", label: "NO BET" },
  UNAVAILABLE: { bg: "bg-surface-2 text-muted", label: "UNAVAILABLE" },
};
function Icon({ d }: { d: AnyDecision }) {
  if (d === "BET_MORE" || d === "BET_LESS" || d === "APPROVE_ENTRY") return <CircleCheck className="h-6 w-6" />;
  if (d === "WAIT") return <Clock className="h-6 w-6" />;
  if (d === "NO_BET") return <Ban className="h-6 w-6" />;
  return <HelpCircle className="h-6 w-6" />;
}

export default function DecisionsPage() {
  const [date, setDate] = useState(todayIso());
  const [entryType, setEntryType] = useState<"power" | "flex">("flex");
  const [assumeValidated, setAssumeValidated] = useState(false);
  const [busy, setBusy] = useState(false);
  const [entry, setEntry] = useState<DecisionResult | null>(null);
  const [legs, setLegs] = useState<DecisionResult[]>([]);
  const [warnings, setWarnings] = useState<string[]>([]);
  const [boardSize, setBoardSize] = useState(0);

  useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect
    setBoardSize(readBoard(date).length);
  }, [date]);

  const run = useCallback(async () => {
    const board = readBoard(date);
    setBoardSize(board.length);
    if (board.length < 2) {
      setEntry(null);
      setWarnings(["Import at least 2 PrizePicks legs on the PrizePicks Board for this date."]);
      return;
    }
    setBusy(true);
    try {
      const res = await fetch("/api/prizepicks/decision", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ board, entryType, date, assumeValidatedMarkets: assumeValidated }),
      });
      const data = await res.json();
      setEntry(data.entryDecision ?? null);
      setLegs(data.legDecisions ?? []);
      setWarnings(data.warnings ?? []);
    } catch {
      setWarnings(["Decision request failed."]);
    } finally {
      setBusy(false);
    }
  }, [date, entryType, assumeValidated]);

  return (
    <div className="space-y-4">
      <div className="panel flex flex-wrap items-center gap-3 p-3">
        <Gavel className="h-5 w-5 text-brand-500" />
        <div className="mr-2">
          <div className="text-sm font-bold leading-tight">Decision Center</div>
          <div className="text-[11px] text-muted">Firm, rules-based decisions · not a guarantee</div>
        </div>
        <input type="date" value={date} onChange={(e) => setDate(e.target.value)} className="h-8 rounded-lg border border-border bg-surface px-2 text-sm outline-none" />
        <select value={entryType} onChange={(e) => setEntryType(e.target.value as "power" | "flex")} className="h-8 rounded-lg border border-border bg-surface px-2 text-sm outline-none">
          <option value="flex">Flex</option>
          <option value="power">Power</option>
        </select>
        <label className="flex items-center gap-1.5 text-[11px] text-muted">
          <input type="checkbox" checked={assumeValidated} onChange={(e) => setAssumeValidated(e.target.checked)} />
          Assume validated markets (research override)
        </label>
        <button onClick={() => void run()} disabled={busy} className="ml-auto inline-flex items-center gap-1 rounded-lg bg-brand-500 px-3 py-1.5 text-xs font-semibold text-white hover:bg-brand-600 disabled:opacity-40">
          {busy ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <RefreshCw className="h-3.5 w-3.5" />} Decide entry ({boardSize} legs)
        </button>
      </div>

      {warnings.length > 0 && (
        <div className="rounded-xl border border-[var(--warning)]/30 bg-[var(--warning)]/10 p-3">
          <div className="mb-1 flex items-center gap-1 text-[11px] font-semibold text-[var(--warning)]"><ShieldAlert className="h-3.5 w-3.5" /> Notices</div>
          <ul className="space-y-0.5 pl-4 text-[11px] text-foreground/80">{warnings.slice(0, 8).map((w, i) => <li key={i} className="list-disc">{w}</li>)}</ul>
        </div>
      )}

      {entry && (
        <div className="panel p-4">
          <div className={cn("flex items-center gap-3 rounded-xl px-4 py-3", STYLE[entry.decision].bg)}>
            <Icon d={entry.decision} />
            <div>
              <div className="text-xl font-black tracking-tight">{STYLE[entry.decision].label}</div>
              <div className="text-[11px] opacity-90">{entry.subjectType === "ENTRY" ? "Complete entry" : "Leg"} · policy {entry.decisionPolicyVersion} · model {entry.modelVersion}</div>
            </div>
            <div className="ml-auto text-right text-[11px]">
              {entry.entryExpectedReturn != null && <div>Exp. return <b>{entry.entryExpectedReturn}×</b></div>}
              {entry.downsideProbability != null && <div>Downside <b>{pct(entry.downsideProbability)}</b></div>}
            </div>
          </div>

          {entry.vetoes.length > 0 && (
            <div className="mt-3">
              <div className="mb-1 text-[11px] font-semibold uppercase tracking-wide text-[var(--negative)]">Vetoes (block any BET)</div>
              <ul className="space-y-0.5 text-[12px]">{entry.vetoes.map((v, i) => <li key={i}>· <b>{v.code}</b> — {v.message}</li>)}</ul>
            </div>
          )}
          {entry.reasons.filter((r) => r.severity !== "INFO").length > 0 && (
            <div className="mt-3">
              <div className="mb-1 text-[11px] font-semibold uppercase tracking-wide text-muted">Reasons</div>
              <ul className="space-y-0.5 text-[12px]">{entry.reasons.filter((r) => r.severity !== "INFO").slice(0, 10).map((r, i) => <li key={i}>· [{r.severity}] {r.message}</li>)}</ul>
            </div>
          )}
          {entry.decision === "WAIT" && entry.releaseConditions?.length ? (
            <div className="mt-3 rounded-lg border border-border bg-surface-2/40 p-2 text-[12px]">
              <div className="font-semibold">To release this WAIT:</div>
              <ul className="mt-0.5 space-y-0.5">{entry.releaseConditions.map((c, i) => <li key={i}>· {c}</li>)}</ul>
              {entry.nextReviewAt && <div className="mt-1 text-muted-2">Next review ~{new Date(entry.nextReviewAt).toLocaleTimeString()}.</div>}
            </div>
          ) : null}

          <div className="mt-4 grid gap-2 sm:grid-cols-2 xl:grid-cols-3">
            {legs.map((l, i) => (
              <div key={i} className="rounded-xl border border-border bg-surface-2/40 p-3">
                <div className="flex items-center justify-between">
                  <span className="text-sm font-semibold">{l.market} {l.line}</span>
                  <span className={cn("rounded-md px-2 py-0.5 text-[10px] font-bold", STYLE[l.decision].bg)}>{STYLE[l.decision].label}</span>
                </div>
                <div className="mt-1 grid grid-cols-2 gap-x-3 gap-y-0.5 text-[11px] text-muted">
                  <span>Sel. prob: <b className="text-foreground">{l.selectedSideProbability != null ? pct(l.selectedSideProbability) : "—"}</b></span>
                  <span>Conf: <b className="text-foreground">{l.confidenceScore ?? "—"}</b></span>
                  <span>Data Q: <b className="text-foreground">{l.dataQualityScore ?? "—"}</b></span>
                  <span>Fragility: <b className="text-foreground">{l.fragilityScore ?? "—"}</b></span>
                  <span>Market: <b className="text-foreground">{l.marketValidationState ?? "—"}</b></span>
                  <span>Vetoes: <b className="text-foreground">{l.vetoes.length}</b></span>
                </div>
              </div>
            ))}
          </div>
        </div>
      )}

      {!entry && !busy && warnings.length === 0 && (
        <div className="panel grid place-items-center p-12 text-center text-sm text-muted">
          Import a PrizePicks entry on the board, then click <b className="mx-1">Decide entry</b>.
        </div>
      )}
      <p className="px-1 text-[10px] text-muted-2">Firm ≠ certain. Decisions apply explicit, versioned rules to available data. No lock, guarantee, or sure bet.</p>
    </div>
  );
}
