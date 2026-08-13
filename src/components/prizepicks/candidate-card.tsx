"use client";

import { useState } from "react";
import { Clock, History, Pencil, Archive, BarChart3, AlertTriangle, Loader2 } from "lucide-react";
import { PlayerAvatar } from "@/components/player-avatar";
import { DataQualityBadge } from "@/components/ui/data-badges";
import { cn, pct } from "@/lib/utils";
import type { PrizePicksBoardEntry } from "@/lib/prizepicks/types";
import type { CandidateEvaluation } from "@/lib/prizepicks/types";
import type { RankingResult, Signal } from "@/lib/prizepicks/ranking";
import { marketByCanonical } from "@/lib/prizepicks/market-map";

const SIGNAL_META: Record<Signal, { label: string; cls: string }> = {
  strong: { label: "Strong Candidate", cls: "bg-[var(--positive)]/15 text-[var(--positive)] border-[var(--positive)]/30" },
  lean: { label: "Lean", cls: "bg-[var(--information)]/15 text-[var(--information)] border-[var(--information)]/30" },
  watch: { label: "Watch", cls: "bg-[var(--warning)]/15 text-[var(--warning)] border-[var(--warning)]/30" },
  avoid: { label: "Avoid", cls: "bg-surface-2 text-muted border-border" },
};

const PROJ_TYPE: Record<string, string> = {
  standard: "border-border text-muted",
  goblin: "border-[var(--positive)]/40 text-[var(--positive)]",
  demon: "border-[var(--negative)]/40 text-[var(--negative)]",
  unknown: "border-border text-muted-2",
};

export function CandidateCard({
  entry,
  evaluation,
  ranking,
  loading,
  onEditLine,
  onArchive,
}: {
  entry: PrizePicksBoardEntry;
  evaluation?: CandidateEvaluation | null;
  ranking?: RankingResult | null;
  loading?: boolean;
  onEditLine: (entry: PrizePicksBoardEntry) => void;
  onArchive: (entry: PrizePicksBoardEntry) => void;
}) {
  const [showHistory, setShowHistory] = useState(false);
  const market = marketByCanonical(entry.marketKey);
  const signal = ranking?.signal ?? "avoid";
  const meta = SIGNAL_META[signal];
  const dir = ranking?.direction;

  return (
    <div className="panel overflow-hidden">
      {/* Signal + score strip */}
      <div className="flex items-center justify-between border-b border-border px-4 py-2">
        <span className={cn("inline-flex items-center gap-1 rounded-md border px-2 py-0.5 text-[11px] font-semibold", meta.cls)}>
          {meta.label}
        </span>
        <span className="text-[11px] text-muted">
          {ranking ? (
            <>
              <span className="font-bold tabular-nums text-foreground">{ranking.score}</span>
              <span className="text-muted-2"> exp. score</span>
            </>
          ) : loading ? (
            <Loader2 className="h-3 w-3 animate-spin" />
          ) : (
            "not analyzed"
          )}
        </span>
      </div>

      <div className="p-4">
        <div className="flex items-start gap-3">
          <PlayerAvatar playerId={entry.mlbPlayerId} name={entry.rawPlayerName} teamId={entry.mlbTeamId} size="md" shape="rounded" />
          <div className="min-w-0 flex-1">
            <div className="truncate font-semibold leading-tight">{entry.rawPlayerName}</div>
            <div className="truncate text-xs text-muted">
              {entry.position || "—"} · {entry.resolvedTeamName ?? entry.teamAbbreviation ?? "—"}
              {entry.opponentName ? ` vs ${abbr(entry.opponentName)}` : ""}
            </div>
          </div>
        </div>

        {/* Two clearly separated columns: PrizePicks vs Diamond Edge */}
        <div className="mt-3 grid grid-cols-2 gap-2">
          <div className="rounded-lg border border-[var(--information)]/25 bg-[var(--information)]/5 p-2.5">
            <div className="text-[10px] font-semibold uppercase tracking-wide text-[var(--information)]">PrizePicks</div>
            <div className="mt-1 text-sm">
              <span className="text-muted">{market?.label ?? entry.rawMarketLabel}</span>
            </div>
            <div className="mt-0.5 flex items-center gap-1.5">
              <span className="text-lg font-bold tabular-nums">{entry.line}</span>
              <span className={cn("rounded border px-1 text-[10px] font-medium capitalize", PROJ_TYPE[entry.projectionType])}>
                {entry.projectionType}
              </span>
            </div>
            {entry.alternativeLines && entry.alternativeLines.length > 0 && (
              <div className="mt-1 flex flex-wrap gap-1">
                {entry.alternativeLines.map((a, i) => (
                  <span key={i} className={cn("rounded border px-1 text-[9px] font-medium capitalize tabular-nums", PROJ_TYPE[a.projectionType])}>
                    {a.projectionType} {a.line}
                  </span>
                ))}
              </div>
            )}
            {(entry.sourceAverageL5 !== undefined || (entry.sourceHistory && entry.sourceHistory.length > 0)) && (
              <div className="mt-1 text-[9px] text-muted-2">
                {entry.sourceHistory && entry.sourceHistory.length > 0 && <>PP L5: {entry.sourceHistory.map((h) => h.value).join(", ")}</>}
                {entry.sourceAverageL5 !== undefined && <>{entry.sourceHistory && entry.sourceHistory.length > 0 ? " · " : "PP "}avg {entry.sourceAverageL5}</>}
              </div>
            )}
          </div>

          <div className="rounded-lg border border-brand-500/25 bg-brand-500/5 p-2.5">
            <div className="text-[10px] font-semibold uppercase tracking-wide text-brand-500">Diamond Edge</div>
            {evaluation ? (
              <>
                <div className="mt-1 text-sm">
                  <span className="text-muted">proj</span>{" "}
                  <span className="font-bold tabular-nums">{evaluation.projection}</span>{" "}
                  <span className={cn("text-xs tabular-nums", evaluation.projectionDiff >= 0 ? "text-[var(--positive)]" : "text-[var(--negative)]")}>
                    ({evaluation.projectionDiff >= 0 ? "+" : ""}{evaluation.projectionDiff})
                  </span>
                </div>
                <div className="mt-0.5 text-sm font-semibold tabular-nums">
                  <span className={cn(dir === "more" && "text-[var(--positive)]")}>M {pct(evaluation.probMore, 0)}</span>
                  <span className="text-muted-2"> / </span>
                  <span className={cn(dir === "less" && "text-[var(--negative)]")}>L {pct(evaluation.probLess, 0)}</span>
                  {evaluation.probPush > 0 && <span className="text-muted-2"> / P {pct(evaluation.probPush, 0)}</span>}
                </div>
                {evaluation.alternativeLines && evaluation.alternativeLines.length > 0 && (
                  <div className="mt-1 space-y-0.5 border-t border-brand-500/15 pt-1 text-[10px] tabular-nums text-muted">
                    {evaluation.alternativeLines.map((a, i) => (
                      <div key={i} className="flex items-center justify-between">
                        <span className="capitalize">{a.projectionType} {a.line}</span>
                        <span>M {pct(a.probMore, 0)} / L {pct(a.probLess, 0)}</span>
                      </div>
                    ))}
                  </div>
                )}
              </>
            ) : (
              <div className="mt-1 text-sm text-muted-2">{loading ? "analyzing…" : "run analytics"}</div>
            )}
          </div>
        </div>

        {/* Hit rates + quality */}
        {evaluation && (
          <>
            <div className="mt-3 grid grid-cols-4 gap-1 text-center">
              {(["l5", "l10", "l20", "season"] as const).map((w) => (
                <div key={w} className="rounded bg-surface-2/60 py-1">
                  <div className="text-[9px] uppercase text-muted-2">{w === "season" ? "SZN" : w.toUpperCase()}</div>
                  <div className="text-xs font-bold tabular-nums">{pct(evaluation.hitRates[w], 0)}</div>
                </div>
              ))}
            </div>
            <div className="mt-2 flex flex-wrap items-center gap-1.5">
              <DataQualityBadge score={evaluation.dataQuality} />
              <span className="rounded-md border border-border bg-surface-2 px-1.5 py-0.5 text-[10px] text-muted">
                agree {pct(evaluation.modelAgreement, 0)}
              </span>
              {evaluation.warnings.slice(0, 2).map((w) => (
                <span key={w.code} className="inline-flex items-center gap-1 text-[10px] text-[var(--warning)]">
                  <AlertTriangle className="h-2.5 w-2.5" /> {w.code.replace(/_/g, " ")}
                </span>
              ))}
            </div>
          </>
        )}

        {/* Source + timestamps */}
        <div className="mt-3 flex flex-wrap items-center gap-x-3 gap-y-1 border-t border-border pt-2 text-[10px] text-muted-2">
          <span className="inline-flex items-center gap-1">
            <Clock className="h-2.5 w-2.5" /> line captured {timeAgo(entry.capturedAt)}
          </span>
          <span>source: {entry.sourceType}</span>
          {entry.snapshots.length > 1 && (
            <button onClick={() => setShowHistory((s) => !s)} className="inline-flex items-center gap-1 text-brand-500 hover:underline">
              <History className="h-2.5 w-2.5" /> {entry.snapshots.length} snapshots
            </button>
          )}
        </div>

        {showHistory && (
          <div className="mt-2 rounded-lg border border-border bg-surface-2/50 p-2 text-[11px]">
            <div className="mb-1 font-semibold text-muted">Captured Line History</div>
            {entry.snapshots.map((s, i) => (
              <div key={i} className="flex items-center justify-between tabular-nums text-muted">
                <span>{new Date(s.capturedAt).toLocaleString()}</span>
                <span>
                  {s.line} · {s.projectionType} · {s.sourceType}
                </span>
              </div>
            ))}
          </div>
        )}

        {/* Actions (no submit) */}
        <div className="mt-3 grid grid-cols-3 gap-1.5">
          <a
            href={entry.mlbPlayerId ? `/players/${entry.mlbPlayerId}/analysis` : "#"}
            className={cn(
              "flex items-center justify-center gap-1 rounded-lg border border-border py-1.5 text-[11px] font-medium hover:bg-surface-hover",
              !entry.mlbPlayerId && "pointer-events-none opacity-40",
            )}
          >
            <BarChart3 className="h-3 w-3" /> Full
          </a>
          <button onClick={() => onEditLine(entry)} className="flex items-center justify-center gap-1 rounded-lg border border-border py-1.5 text-[11px] font-medium hover:bg-surface-hover">
            <Pencil className="h-3 w-3" /> Edit line
          </button>
          <button onClick={() => onArchive(entry)} className="flex items-center justify-center gap-1 rounded-lg border border-border py-1.5 text-[11px] font-medium text-muted hover:bg-surface-hover">
            <Archive className="h-3 w-3" /> Archive
          </button>
        </div>
      </div>
    </div>
  );
}

function abbr(name?: string) {
  if (!name) return "—";
  const p = name.split(" ");
  return p[p.length - 1].slice(0, 4);
}
function timeAgo(ts: string) {
  const s = Math.max(0, Math.round((Date.now() - new Date(ts).getTime()) / 1000));
  if (s < 60) return `${s}s ago`;
  const m = Math.round(s / 60);
  if (m < 60) return `${m}m ago`;
  return `${Math.round(m / 60)}h ago`;
}
