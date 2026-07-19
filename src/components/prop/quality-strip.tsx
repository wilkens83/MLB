"use client";

import { ShieldCheck, ShieldAlert, Shield, Clock, Info, AlertTriangle } from "lucide-react";
import { cn } from "@/lib/utils";
import type { DataQuality, PredictionWarning } from "@/lib/domain/models";

export function QualityStrip({
  quality,
  lastUpdated,
  opponentPitcher,
}: {
  quality: DataQuality;
  lastUpdated: number;
  opponentPitcher?: string;
}) {
  const Icon = quality.tier === "high" ? ShieldCheck : quality.tier === "medium" ? Shield : ShieldAlert;
  const tone =
    quality.tier === "high"
      ? "text-[var(--positive)]"
      : quality.tier === "medium"
        ? "text-[var(--warning)]"
        : "text-[var(--negative)]";

  return (
    <div className="flex flex-wrap items-center gap-x-4 gap-y-2 rounded-xl border border-border bg-surface-2/40 px-4 py-2.5 text-xs">
      <span className={cn("flex items-center gap-1.5 font-semibold", tone)}>
        <Icon className="h-4 w-4" />
        Data quality {quality.score}/100 · {quality.tier}
      </span>
      <span className="text-muted">{quality.sampleSize} games</span>
      <span className="text-muted">{quality.hasStatcast ? "Statcast ✓" : "Statcast —"}</span>
      <span className="text-muted">{quality.hasOpponent ? "Opponent ✓" : "Opponent —"}</span>
      {opponentPitcher && <span className="text-muted">vs {opponentPitcher}</span>}
      <span className="ml-auto flex items-center gap-1 text-muted-2">
        <Clock className="h-3 w-3" />
        Updated {timeAgo(lastUpdated)}
      </span>
    </div>
  );
}

export function WarningList({ warnings }: { warnings: PredictionWarning[] }) {
  if (warnings.length === 0) return null;
  return (
    <div className="flex flex-wrap gap-2">
      {warnings.map((w) => {
        const tone =
          w.severity === "high"
            ? "border-[var(--negative)]/30 bg-[var(--negative)]/8 text-[var(--negative)]"
            : w.severity === "warn"
              ? "border-[var(--warning)]/30 bg-[var(--warning)]/8 text-[var(--warning)]"
              : "border-border bg-surface-2/50 text-muted";
        const Icon = w.severity === "info" ? Info : AlertTriangle;
        return (
          <span key={w.code} className={cn("inline-flex items-center gap-1.5 rounded-lg border px-2.5 py-1 text-[11px]", tone)}>
            <Icon className="h-3 w-3 shrink-0" />
            {w.message}
          </span>
        );
      })}
    </div>
  );
}

function timeAgo(ts: number) {
  const s = Math.max(0, Math.round((Date.now() - ts) / 1000));
  if (s < 60) return `${s}s ago`;
  const m = Math.round(s / 60);
  if (m < 60) return `${m}m ago`;
  const h = Math.round(m / 60);
  return `${h}h ago`;
}
