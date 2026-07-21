"use client";

import { ShieldCheck, Shield, ShieldAlert, CheckCircle2, CircleDot, HelpCircle } from "lucide-react";
import { cn } from "@/lib/utils";

/** Data-quality badge — colored by the (already-computed) score. */
export function DataQualityBadge({ score, className }: { score: number; className?: string }) {
  const tier = score >= 70 ? "high" : score >= 45 ? "medium" : "low";
  const Icon = tier === "high" ? ShieldCheck : tier === "medium" ? Shield : ShieldAlert;
  const tone =
    tier === "high"
      ? "border-[var(--positive)]/30 bg-[var(--positive)]/10 text-[var(--positive)]"
      : tier === "medium"
        ? "border-[var(--warning)]/30 bg-[var(--warning)]/10 text-[var(--warning)]"
        : "border-[var(--negative)]/30 bg-[var(--negative)]/10 text-[var(--negative)]";
  return (
    <span
      className={cn("inline-flex items-center gap-1 rounded-md border px-1.5 py-0.5 text-[11px] font-semibold tabular-nums", tone, className)}
      title={`Data quality ${score}/100 (${tier})`}
    >
      <Icon className="h-3 w-3" aria-hidden />
      DQ {score}
    </span>
  );
}

export type LineupState = "confirmed" | "projected" | "probable" | "unconfirmed";

/** Lineup-status badge — confirmed / projected / probable / not confirmed. */
export function LineupStatusBadge({ status, className }: { status: string; className?: string }) {
  const s = (status as LineupState) ?? "unconfirmed";
  const meta: Record<LineupState, { label: string; icon: typeof CheckCircle2; tone: string }> = {
    confirmed: { label: "Confirmed", icon: CheckCircle2, tone: "border-[var(--positive)]/30 bg-[var(--positive)]/10 text-[var(--positive)]" },
    projected: { label: "Projected", icon: CircleDot, tone: "border-[var(--information)]/30 bg-[var(--information)]/10 text-[var(--information)]" },
    probable: { label: "Probable", icon: CircleDot, tone: "border-[var(--information)]/30 bg-[var(--information)]/10 text-[var(--information)]" },
    unconfirmed: { label: "Not confirmed", icon: HelpCircle, tone: "border-border bg-surface-2 text-muted" },
  };
  const m = meta[s] ?? meta.unconfirmed;
  const Icon = m.icon;
  return (
    <span className={cn("inline-flex items-center gap-1 rounded-md border px-1.5 py-0.5 text-[11px] font-medium", m.tone, className)}>
      <Icon className="h-3 w-3" aria-hidden />
      {m.label}
    </span>
  );
}

/** Compact metric module for analytics grids. */
export function MetricCard({
  label,
  value,
  sub,
  tone = "default",
  emphasis = false,
}: {
  label: string;
  value: React.ReactNode;
  sub?: string;
  tone?: "default" | "positive" | "negative" | "accent";
  emphasis?: boolean;
}) {
  const toneClass =
    tone === "positive"
      ? "text-[var(--positive)]"
      : tone === "negative"
        ? "text-[var(--negative)]"
        : tone === "accent"
          ? "text-brand-500"
          : "text-foreground";
  return (
    <div className="rounded-lg border border-border bg-surface-2/60 px-3 py-2.5">
      <div className="text-[10px] font-medium uppercase tracking-wide text-muted">{label}</div>
      <div className={cn("mt-0.5 font-bold tabular-nums", emphasis ? "text-2xl" : "text-lg", toneClass)}>{value}</div>
      {sub && <div className="text-[11px] text-muted-2">{sub}</div>}
    </div>
  );
}
