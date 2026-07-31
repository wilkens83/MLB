"use client";

import { Database, Radio, Cloud, Cpu, ClipboardList } from "lucide-react";
import { cn } from "@/lib/utils";
import type { DataSourceReference, FreshnessStatus } from "../schemas/sources";

const FRESH_STYLE: Record<FreshnessStatus, string> = {
  live: "text-[var(--positive)] border-[var(--positive)]/30 bg-[var(--positive)]/10",
  fresh: "text-[var(--info)] border-[var(--info)]/30 bg-[var(--info)]/10",
  stale: "text-[var(--warning)] border-[var(--warning)]/30 bg-[var(--warning)]/10",
  historical: "text-muted border-border bg-surface-2",
  unknown: "text-muted-2 border-border bg-surface-2",
};

function icon(type: DataSourceReference["type"]) {
  switch (type) {
    case "mlb-stats-api": return Radio;
    case "baseball-savant": return Cloud;
    case "diamond-edge-model": return Cpu;
    case "prizepicks-import": return ClipboardList;
    default: return Database;
  }
}

function ago(iso?: string): string {
  if (!iso) return "unknown";
  const ms = Date.now() - Date.parse(iso);
  if (!Number.isFinite(ms)) return "unknown";
  const m = Math.round(ms / 60000);
  if (m < 1) return "just now";
  if (m < 60) return `${m}m ago`;
  const h = Math.round(m / 60);
  if (h < 24) return `${h}h ago`;
  return `${Math.round(h / 24)}d ago`;
}

export function FreshnessBadge({ status }: { status: FreshnessStatus }) {
  return (
    <span className={cn("inline-flex items-center rounded-full border px-1.5 py-0.5 text-[9px] font-semibold uppercase tracking-wide", FRESH_STYLE[status])}>
      {status}
    </span>
  );
}

export function SourceList({ sources }: { sources: DataSourceReference[] }) {
  if (sources.length === 0) return null;
  return (
    <div className="mt-2 rounded-lg border border-border bg-surface-2/40 p-2">
      <div className="mb-1 text-[10px] font-semibold uppercase tracking-wider text-muted-2">Sources</div>
      <ul className="space-y-1">
        {sources.map((s) => {
          const Icon = icon(s.type);
          return (
            <li key={s.id} className="flex items-center gap-2 text-[11px]">
              <Icon className="h-3 w-3 shrink-0 text-muted" />
              <span className="font-medium text-foreground/90">{s.name}</span>
              {s.modelVersion && <span className="text-muted-2">· {s.modelVersion}</span>}
              <span className="text-muted-2">· updated {ago(s.dataAsOf ?? s.retrievedAt)}</span>
              <span className="ml-auto"><FreshnessBadge status={s.freshnessStatus} /></span>
            </li>
          );
        })}
      </ul>
    </div>
  );
}
