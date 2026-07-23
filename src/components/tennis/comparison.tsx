/* ============================================================================
   Head-to-head comparison scaffold for the tennis match-analysis view. It renders
   the real interface (labelled metric rows for two sides) but shows an explicit
   "unavailable" marker wherever a value is absent — it never invents a number.
   ========================================================================== */

import type { ReactNode } from "react";
import { cn } from "@/lib/utils";

export interface CompareRow {
  label: string;
  /** Left/right values; undefined ⇒ rendered as an unavailable marker. */
  home?: number | string;
  away?: number | string;
  /** Higher-is-better tints the leader; set false for double-faults etc. */
  higherBetter?: boolean;
  format?: (v: number) => string;
}

function cell(v: number | string | undefined, format?: (n: number) => string) {
  if (v === undefined) return <span className="text-muted-2">—</span>;
  if (typeof v === "number") return <span className="tabular-nums">{format ? format(v) : v}</span>;
  return <span>{v}</span>;
}

export function ComparisonCard({
  title,
  icon,
  rows,
  homeName = "Player A",
  awayName = "Player B",
  note,
}: {
  title: string;
  icon?: ReactNode;
  rows: CompareRow[];
  homeName?: string;
  awayName?: string;
  note?: string;
}) {
  const anyData = rows.some((r) => r.home !== undefined || r.away !== undefined);
  return (
    <div className="glass rounded-2xl p-5">
      <h3 className="mb-3 flex items-center gap-2 font-semibold">
        {icon}
        {title}
      </h3>
      <div className="grid grid-cols-[1fr_auto_1fr] items-center gap-x-3 border-b border-border pb-2 text-[11px] font-semibold uppercase tracking-wider text-muted-2">
        <span className="text-right">{homeName}</span>
        <span className="text-center">Metric</span>
        <span>{awayName}</span>
      </div>
      <ul className="divide-y divide-border">
        {rows.map((r) => (
          <li key={r.label} className="grid grid-cols-[1fr_auto_1fr] items-center gap-x-3 py-2 text-sm">
            <span className="text-right font-medium">{cell(r.home, r.format)}</span>
            <span className="text-center text-xs text-muted">{r.label}</span>
            <span className="font-medium">{cell(r.away, r.format)}</span>
          </li>
        ))}
      </ul>
      {(note || !anyData) && (
        <p className={cn("mt-3 text-xs", anyData ? "text-muted-2" : "text-muted")}>
          {note ??
            "Metrics populate from resolved match inputs once a live provider is connected. No values are fabricated."}
        </p>
      )}
    </div>
  );
}
