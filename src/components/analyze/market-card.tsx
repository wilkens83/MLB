"use client";

import { TrendingUp, TrendingDown, Minus, Plus, Check, BarChart3 } from "lucide-react";
import { PlayerAvatar } from "@/components/player-avatar";
import { DataQualityBadge, LineupStatusBadge } from "@/components/ui/data-badges";
import { cn, pct } from "@/lib/utils";
import { useWorkspace } from "./workspace-store";
import type { MarketCard as CardData } from "@/lib/mlb/market";

export function MarketCard({ card }: { card: CardData }) {
  const ws = useWorkspace();
  const selected = ws.has(card.playerId, card.market);

  function addSide(side: "over" | "under") {
    ws.add({
      playerId: card.playerId,
      name: card.name,
      isPitcher: card.isPitcher,
      market: card.market,
      marketLabel: card.marketLabel,
      line: card.line,
      side,
      overOdds: "-110",
      underOdds: "-110",
      gamePk: card.gamePk,
      teamId: card.teamId,
      teamName: card.teamName,
      opponentName: card.opponentName,
    });
  }

  const TrendIcon = card.trend === "up" ? TrendingUp : card.trend === "down" ? TrendingDown : Minus;
  const trendColor =
    card.trend === "up" ? "text-[var(--positive)]" : card.trend === "down" ? "text-[var(--negative)]" : "text-muted";

  return (
    <div
      className={cn(
        "panel p-4 transition-colors hover:border-border-strong",
        selected && "border-brand-500/50 ring-1 ring-brand-500/40",
      )}
    >
      <div className="flex items-start gap-3">
        <a href={`/players/${card.playerId}/analysis`} aria-label={`Full analysis for ${card.name}`}>
          <PlayerAvatar playerId={card.playerId} name={card.name} teamId={card.teamId} size="md" shape="rounded" />
        </a>
        <div className="min-w-0 flex-1">
          <div className="flex items-center gap-1.5">
            {card.battingOrder && (
              <span className="rounded bg-surface-2 px-1 text-[10px] font-bold tabular-nums text-muted">{card.battingOrder}</span>
            )}
            <a href={`/players/${card.playerId}/analysis`} className="truncate font-semibold leading-tight hover:text-brand-500">
              {card.name}
            </a>
          </div>
          <div className="truncate text-xs text-muted">
            {card.position} · {card.teamName} {card.isHome ? "vs" : "@"} {abbr(card.opponentName)}
          </div>
        </div>
        <span className={cn("flex items-center gap-1 text-xs font-medium", trendColor)} title={`Trend ${card.trend}`}>
          <TrendIcon className="h-3.5 w-3.5" aria-hidden />
        </span>
      </div>

      <div className="mt-3 flex items-end justify-between">
        <div>
          <div className="text-[11px] uppercase tracking-wide text-muted">{card.marketLabel}</div>
          <div className="text-sm">
            <span className="font-bold">{card.line}</span>{" "}
            <span className="text-muted">· proj</span>{" "}
            <span className="font-bold text-brand-500 tabular-nums">{card.projection}</span>
          </div>
        </div>
        <div className="text-right">
          <div className="text-[11px] text-muted">Over / Under</div>
          <div className="text-sm font-semibold tabular-nums">
            <span className="text-[var(--positive)]">{pct(card.overProb, 0)}</span>
            <span className="text-muted-2"> / </span>
            <span className="text-[var(--negative)]">{pct(card.underProb, 0)}</span>
          </div>
        </div>
      </div>

      <div className="mt-3 grid grid-cols-4 gap-1 text-center">
        {(["l5", "l10", "l20", "season"] as const).map((w) => (
          <div key={w} className="rounded-lg bg-surface-2/50 py-1">
            <div className="text-[10px] uppercase text-muted-2">{w === "season" ? "SZN" : w.toUpperCase()}</div>
            <div className={cn("text-xs font-bold tabular-nums", card.hitRates[w] >= 0.6 ? "text-[var(--positive)]" : card.hitRates[w] < 0.45 ? "text-[var(--negative)]" : "")}>
              {pct(card.hitRates[w], 0)}
            </div>
          </div>
        ))}
      </div>

      <div className="mt-3 flex items-center justify-between gap-2">
        <div className="flex items-center gap-1.5">
          <DataQualityBadge score={card.dataQuality} />
          <LineupStatusBadge status={card.lineupStatus} />
        </div>
        <span className="text-[10px] tabular-nums text-muted-2">{card.sampleSize} G</span>
      </div>

      <div className="mt-2 grid grid-cols-2 gap-2">
        <button
          onClick={() => addSide("over")}
          className="flex items-center justify-center gap-1 rounded-lg bg-[var(--positive)]/12 py-1.5 text-xs font-semibold text-[var(--positive)] transition-colors hover:bg-[var(--positive)]/20"
        >
          {selected ? <Check className="h-3 w-3" aria-hidden /> : <Plus className="h-3 w-3" aria-hidden />} Analyze Over
        </button>
        <button
          onClick={() => addSide("under")}
          className="flex items-center justify-center gap-1 rounded-lg bg-[var(--negative)]/12 py-1.5 text-xs font-semibold text-[var(--negative)] transition-colors hover:bg-[var(--negative)]/20"
        >
          {selected ? <Check className="h-3 w-3" aria-hidden /> : <Plus className="h-3 w-3" aria-hidden />} Analyze Under
        </button>
      </div>
      <a
        href={`/players/${card.playerId}/analysis`}
        className="mt-2 flex items-center justify-center gap-1 rounded-lg border border-border py-1.5 text-xs font-medium text-muted transition-colors hover:bg-surface-hover hover:text-foreground"
      >
        <BarChart3 className="h-3 w-3" aria-hidden /> View Full Analysis
      </a>
    </div>
  );
}

function abbr(name?: string) {
  if (!name) return "—";
  const p = name.split(" ");
  return p[p.length - 1].slice(0, 4);
}
