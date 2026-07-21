"use client";

import { TrendingUp, TrendingDown, Minus, Plus, Check } from "lucide-react";
import { PlayerHeadshot } from "@/components/player-headshot";
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
  const dqColor =
    card.dataQuality >= 70 ? "text-[var(--positive)]" : card.dataQuality >= 45 ? "text-[var(--warning)]" : "text-[var(--negative)]";

  return (
    <div className={cn("glass rounded-2xl p-4 transition-shadow", selected && "ring-1 ring-brand-500/50")}>
      <div className="flex items-start gap-3">
        <a href={`/players/${card.playerId}/analysis`}>
          <PlayerHeadshot playerId={card.playerId} name={card.name} size={44} />
        </a>
        <div className="min-w-0 flex-1">
          <div className="flex items-center gap-1.5">
            <a href={`/players/${card.playerId}/analysis`} className="truncate font-semibold hover:text-brand-500">
              {card.name}
            </a>
            {card.battingOrder && (
              <span className="rounded bg-surface-2 px-1 text-[10px] font-bold text-muted">#{card.battingOrder}</span>
            )}
          </div>
          <div className="truncate text-xs text-muted">
            {card.position} · {card.teamName} {card.isHome ? "vs" : "@"} {abbr(card.opponentName)}
          </div>
        </div>
        <span className={cn("flex items-center gap-1 text-xs font-medium", trendColor)}>
          <TrendIcon className="h-3.5 w-3.5" />
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

      <div className="mt-3 flex items-center justify-between">
        <span className={cn("text-[11px] font-medium", dqColor)}>DQ {card.dataQuality}</span>
        <span className="text-[10px] text-muted-2">{card.sampleSize} G</span>
      </div>

      <div className="mt-2 grid grid-cols-2 gap-2">
        <button
          onClick={() => addSide("over")}
          className="flex items-center justify-center gap-1 rounded-lg bg-[var(--positive)]/12 py-1.5 text-xs font-semibold text-[var(--positive)] transition-colors hover:bg-[var(--positive)]/20"
        >
          {selected ? <Check className="h-3 w-3" /> : <Plus className="h-3 w-3" />} Over
        </button>
        <button
          onClick={() => addSide("under")}
          className="flex items-center justify-center gap-1 rounded-lg bg-[var(--negative)]/12 py-1.5 text-xs font-semibold text-[var(--negative)] transition-colors hover:bg-[var(--negative)]/20"
        >
          {selected ? <Check className="h-3 w-3" /> : <Plus className="h-3 w-3" />} Under
        </button>
      </div>
    </div>
  );
}

function abbr(name?: string) {
  if (!name) return "—";
  const p = name.split(" ");
  return p[p.length - 1].slice(0, 4);
}
