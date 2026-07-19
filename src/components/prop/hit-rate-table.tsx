"use client";

import { MeterBar } from "@/components/ui/primitives";
import { cn, pct } from "@/lib/utils";
import type { HitRateResult } from "@/lib/analytics/hitRate";

const WINDOW_LABEL: Record<string, string> = {
  "5": "L5",
  "10": "L10",
  "15": "L15",
  "20": "L20",
  "30": "L30",
  season: "Season",
};

export function HitRateTable({ rows }: { rows: HitRateResult[] }) {
  return (
    <div className="space-y-2.5">
      {rows.map((r) => {
        const label = WINDOW_LABEL[String(r.window)] ?? String(r.window);
        const tone = r.rate >= 0.6 ? "positive" : r.rate >= 0.45 ? "brand" : "negative";
        return (
          <div key={String(r.window)} className="flex items-center gap-3">
            <span className="w-14 shrink-0 text-xs font-semibold text-muted">{label}</span>
            <div className="flex-1">
              <MeterBar value={r.rate} tone={tone === "brand" ? "brand" : tone} />
            </div>
            <span
              className={cn(
                "w-12 shrink-0 text-right text-sm font-bold tabular-nums",
                r.rate >= 0.6 ? "text-[var(--positive)]" : r.rate < 0.45 ? "text-[var(--negative)]" : "text-foreground",
              )}
            >
              {pct(r.rate, 0)}
            </span>
            <span className="w-14 shrink-0 text-right text-[11px] text-muted-2">
              {r.hits}/{r.games}
            </span>
            <span className="hidden w-16 shrink-0 text-right text-[11px] text-muted-2 sm:block">
              μ {r.average.toFixed(2)}
            </span>
          </div>
        );
      })}
    </div>
  );
}
