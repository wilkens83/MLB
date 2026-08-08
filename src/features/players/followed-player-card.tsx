/* ============================================================================
   A single followed-player card for the My Players dashboard. Shows the last
   game line, quick window averages (L5/L10/Season) for the primary metric, a
   trend chip, and expandable per-metric performance detail. All HISTORICAL —
   no model probability appears on the card. Includes Performance (expand) and
   Analyze (→ full model workbench) actions and the follow/favorite toggles.
   ========================================================================== */

"use client";

import { useState } from "react";
import Link from "next/link";
import { ChevronDown, ChevronUp, LineChart } from "lucide-react";
import { PlayerAvatar } from "@/components/player-avatar";
import { cn } from "@/lib/utils";
import { getProp } from "@/lib/props/catalog";
import type { FollowedPlayerCard as CardData } from "@/workflows/followed-player-performance";
import type { WindowSummary } from "@/lib/players/performance";
import { SavePlayerButtons } from "./save-player-buttons";
import { PerformanceView } from "./performance-view";

function timeAgo(iso?: string): string {
  if (!iso) return "";
  const ms = Date.now() - new Date(iso).getTime();
  if (!Number.isFinite(ms) || ms < 0) return "just now";
  const min = Math.floor(ms / 60000);
  if (min < 1) return "just now";
  if (min < 60) return `${min} min ago`;
  const hr = Math.floor(min / 60);
  if (hr < 24) return `${hr} h ago`;
  return `${Math.floor(hr / 24)} d ago`;
}

function avg(windows: WindowSummary[], key: string): number | null {
  return windows.find((w) => w.window === key)?.average ?? null;
}

function fmt(n: number | null): string {
  return n === null ? "—" : n.toFixed(2);
}

const TREND_TONE: Record<string, string> = {
  "above-baseline": "text-[var(--positive)]",
  "below-baseline": "text-[var(--negative)]",
  "around-baseline": "text-muted",
  "insufficient-data": "text-muted-2",
};
const TREND_LABEL: Record<string, string> = {
  "above-baseline": "Above baseline",
  "below-baseline": "Below baseline",
  "around-baseline": "Around baseline",
  "insufficient-data": "Not enough games",
};

export function FollowedPlayerCard({ card }: { card: CardData }) {
  const [open, setOpen] = useState(false);
  const primary = card.metrics.find((m) => m.available) ?? card.metrics[0];
  const primaryLabel = primary ? getProp(primary.metric)?.label ?? primary.metric : "";
  const last = primary?.lastGame;

  return (
    <div className="panel p-4">
      <div className="flex items-start gap-3">
        <PlayerAvatar playerId={card.playerId} name={card.displayName ?? "Player"} size="md" shape="rounded" />
        <div className="min-w-0 flex-1">
          <div className="flex items-center gap-2">
            <Link href={`/players/${card.playerId}/analysis`} className="truncate text-sm font-bold hover:underline">
              {card.displayName ?? `Player ${card.playerId}`}
            </Link>
          </div>
          <div className="truncate text-xs text-muted">
            {[card.team, card.position].filter(Boolean).join(" · ")}
          </div>
        </div>
        <SavePlayerButtons playerId={card.playerId} size="sm" />
      </div>

      {!card.available ? (
        <p className="mt-3 rounded-lg border border-border bg-surface-2 px-3 py-2 text-xs text-muted">
          {card.error ? `Data unavailable: ${card.error}` : "No recent game data — nothing shown rather than a fabricated stat."}
        </p>
      ) : (
        <>
          {last && (
            <div className="mt-3 text-xs text-muted">
              Last game{" "}
              <span className="font-semibold text-foreground tabular-nums">
                {last.value} {primaryLabel}
              </span>
              {last.opponent && <span className="text-muted-2"> vs {last.opponent}</span>}
            </div>
          )}

          {primary && (
            <div className="mt-3 grid grid-cols-3 gap-2">
              {(["L5", "L10", "Season"] as const).map((w) => (
                <div key={w} className="rounded-lg border border-border bg-surface-2 px-2 py-1.5 text-center">
                  <div className="text-[10px] uppercase tracking-wider text-muted-2">{w} {primaryLabel}</div>
                  <div className="text-sm font-bold tabular-nums">{fmt(avg(primary.windows, w))}</div>
                </div>
              ))}
            </div>
          )}

          {primary && (
            <div className="mt-2 flex items-center justify-between text-xs">
              <span className={cn("font-medium", TREND_TONE[primary.trend.direction])}>
                {TREND_LABEL[primary.trend.direction]}
              </span>
              <span className="text-muted-2">Updated {timeAgo(card.computedAt)}</span>
            </div>
          )}
        </>
      )}

      <div className="mt-3 flex items-center gap-2">
        {card.available && (
          <button
            type="button"
            onClick={() => setOpen((v) => !v)}
            className="inline-flex items-center gap-1 rounded-lg border border-border bg-surface-2 px-2.5 py-1.5 text-xs font-medium text-muted transition-colors hover:text-foreground"
          >
            {open ? <ChevronUp className="h-3.5 w-3.5" /> : <ChevronDown className="h-3.5 w-3.5" />}
            Performance
          </button>
        )}
        <Link
          href={`/players/${card.playerId}/analysis`}
          className="inline-flex items-center gap-1 rounded-lg border border-brand-500/40 bg-brand-500/10 px-2.5 py-1.5 text-xs font-medium text-brand-500 transition-colors hover:bg-brand-500/20"
        >
          <LineChart className="h-3.5 w-3.5" /> Analyze
        </Link>
      </div>

      {open && card.available && (
        <div className="mt-3 space-y-4 border-t border-border pt-3">
          {card.metrics.map((m) => (
            <PerformanceView key={m.metric} metric={m} />
          ))}
        </div>
      )}
    </div>
  );
}
