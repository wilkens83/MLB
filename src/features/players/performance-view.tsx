/* ============================================================================
   Performance detail for one followed player+metric. Renders the L5/L10/L20/
   Season window table (Average + HISTORICAL Over %) plus trend/variability.

   HARD SEPARATION: this view shows HISTORICAL hit rate ONLY. It never displays a
   model probability — and it carries an explicit note that historical Over % is
   NOT the model's probability. The performance record has no probability field,
   so there is nothing here that could be mistaken for a model output.
   ========================================================================== */

"use client";

import { Info } from "lucide-react";
import { cn, pct } from "@/lib/utils";
import { getProp } from "@/lib/props/catalog";
import type { PlayerMetricPerformance } from "@/lib/players/performance";
import type { PerformanceWindowKey } from "@/lib/players/performance";

const WINDOW_ORDER: PerformanceWindowKey[] = ["L5", "L10", "L20", "Season"];

function fmt(n: number | null, decimals = 2): string {
  return n === null ? "—" : n.toFixed(decimals);
}

const TREND_LABEL: Record<string, string> = {
  "above-baseline": "Above baseline",
  "below-baseline": "Below baseline",
  "around-baseline": "Around baseline",
  "insufficient-data": "Not enough games",
};

export function PerformanceView({ metric }: { metric: PlayerMetricPerformance }) {
  const label = getProp(metric.metric)?.label ?? metric.metric;
  const line = metric.propHistory ? getProp(metric.metric)?.defaultLine : undefined;

  if (!metric.available) {
    return (
      <div className="rounded-xl border border-border bg-surface-2 p-4 text-sm text-muted">
        No game data available for <span className="font-medium text-foreground">{label}</span>. Nothing is shown
        rather than a fabricated zero.
      </div>
    );
  }

  const byWindow = Object.fromEntries(metric.windows.map((w) => [w.window, w]));
  const histByWindow = Object.fromEntries((metric.propHistory ?? []).map((h) => [h.window, h]));

  return (
    <div className="space-y-3">
      <div className="flex flex-wrap items-baseline gap-x-2 gap-y-1">
        <span className="text-sm font-semibold">{label}</span>
        {line !== undefined && (
          <span className="text-xs text-muted">line {line}</span>
        )}
        <span className="ml-auto text-[11px] text-muted-2">{metric.sampleSize} games</span>
      </div>

      <div className="overflow-x-auto">
        <table className="w-full min-w-[420px] text-sm">
          <thead>
            <tr className="text-left text-[11px] uppercase tracking-wider text-muted">
              <th className="pb-1.5 font-semibold">Window</th>
              <th className="pb-1.5 text-right font-semibold">Games</th>
              <th className="pb-1.5 text-right font-semibold">Average</th>
              {metric.propHistory && <th className="pb-1.5 text-right font-semibold">Over %*</th>}
            </tr>
          </thead>
          <tbody className="tabular-nums">
            {WINDOW_ORDER.map((w) => {
              const summary = byWindow[w];
              const hist = histByWindow[w];
              return (
                <tr key={w} className="border-t border-border/60">
                  <td className="py-1.5 font-medium">{w}</td>
                  <td className="py-1.5 text-right text-muted">{summary?.games ?? 0}</td>
                  <td className="py-1.5 text-right">{fmt(summary?.average ?? null)}</td>
                  {metric.propHistory && (
                    <td className="py-1.5 text-right">
                      {hist && hist.overRate !== null ? pct(hist.overRate) : "—"}
                    </td>
                  )}
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>

      <div className="flex flex-wrap items-center gap-2 text-xs">
        <span className={cn("rounded-md border border-border bg-surface-2 px-2 py-0.5")}>
          Trend: <span className="font-medium text-foreground">{TREND_LABEL[metric.trend.direction]}</span>
        </span>
        {metric.variability.stdDev !== null && (
          <span className="rounded-md border border-border bg-surface-2 px-2 py-0.5 text-muted">
            σ {fmt(metric.variability.stdDev)}
          </span>
        )}
        {metric.variability.range && (
          <span className="rounded-md border border-border bg-surface-2 px-2 py-0.5 text-muted">
            range {metric.variability.range[0]}–{metric.variability.range[1]}
          </span>
        )}
      </div>

      {metric.propHistory && (
        <p className="flex items-start gap-1.5 rounded-lg border border-[var(--warning)]/30 bg-[var(--warning)]/5 px-2.5 py-2 text-[11px] leading-relaxed text-muted">
          <Info className="mt-px h-3.5 w-3.5 shrink-0 text-[var(--warning)]" />
          <span>
            <span className="font-semibold text-foreground">* Historical Over % is not a model probability.</span>{" "}
            It counts how often past games cleared the line — it does not predict the next game. Open the player&apos;s
            analysis for the model&apos;s calibrated projection.
          </span>
        </p>
      )}
    </div>
  );
}
