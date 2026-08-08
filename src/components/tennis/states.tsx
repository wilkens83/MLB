/* ============================================================================
   Honest data-state primitives for the tennis surface. Every tennis view uses
   these instead of ever fabricating a match, a projection, or a probability.
   The variants map to the states named in the spec: loading, empty, provider
   not configured / degraded, stale, historical-only, model unavailable, and
   identity unresolved.
   ========================================================================== */

import type { ReactNode } from "react";
import Link from "next/link";
import {
  Info, PlugZap, Clock, TriangleAlert, Cpu, Database, SearchX, ArrowRight, type LucideIcon,
} from "lucide-react";
import { cn } from "@/lib/utils";
import { Skeleton } from "@/components/ui/primitives";

type Tone = "info" | "warning" | "neutral" | "pending";

const TONE: Record<Tone, { ring: string; icon: string; chip: string }> = {
  info: { ring: "border-[var(--info)]/25", icon: "text-[var(--info)]", chip: "bg-[var(--info)]/12" },
  warning: { ring: "border-[var(--warning)]/25", icon: "text-[var(--warning)]", chip: "bg-[var(--warning)]/12" },
  neutral: { ring: "border-border", icon: "text-muted", chip: "bg-surface-2" },
  pending: { ring: "border-brand-500/25", icon: "text-brand-500", chip: "bg-brand-500/12" },
};

export function NoticeCard({
  icon: Icon,
  title,
  children,
  tone = "neutral",
  action,
  className,
}: {
  icon: LucideIcon;
  title: string;
  children?: ReactNode;
  tone?: Tone;
  action?: ReactNode;
  className?: string;
}) {
  const t = TONE[tone];
  return (
    <div className={cn("glass rounded-2xl border p-6 text-center", t.ring, className)}>
      <div className={cn("mx-auto mb-3 grid h-12 w-12 place-items-center rounded-xl", t.chip)}>
        <Icon className={cn("h-6 w-6", t.icon)} />
      </div>
      <p className="font-semibold text-foreground">{title}</p>
      {children && <div className="mx-auto mt-1.5 max-w-md text-sm text-muted">{children}</div>}
      {action && <div className="mt-4 flex justify-center">{action}</div>}
    </div>
  );
}

/**
 * No paid live feed — but NOT a dead end. Free historical analytics, manual
 * matchups, and demo data are available, so this routes the user to what works
 * instead of only reporting what doesn't. LIVE is never faked.
 */
export function ProviderNotConfigured({
  what = "matches",
  className,
}: {
  what?: string;
  className?: string;
}) {
  return (
    <NoticeCard
      icon={PlugZap}
      title="Automated live feed unavailable"
      tone="info"
      className={className}
      action={
        <div className="flex flex-wrap justify-center gap-2">
          <Link href="/tennis/players" className="inline-flex items-center gap-1 rounded-lg bg-brand-500/12 px-3 py-1.5 text-sm font-medium text-brand-500 transition hover:bg-brand-500/20">
            Browse players <ArrowRight className="h-3.5 w-3.5" />
          </Link>
          <Link href="/tennis/matches" className="inline-flex items-center gap-1 rounded-lg border border-border px-3 py-1.5 text-sm font-medium transition hover:border-brand-500/40">
            Historical matches
          </Link>
          <Link href="/tennis/data-health" className="inline-flex items-center gap-1 rounded-lg border border-border px-3 py-1.5 text-sm font-medium transition hover:border-brand-500/40">
            Data mode &amp; sources
          </Link>
        </div>
      }
    >
      No paid provider key is set, so live {what} aren&apos;t available. The Tennis section
      still runs on <span className="font-medium text-foreground">free historical analytics</span> and
      manual matchups — real ATP/WTA data, not fabricated. The Sportradar, SportsDataIO and
      API-Tennis adapters stay inert until a server-side API key is set; free/historical data is
      never presented as live.
    </NoticeCard>
  );
}

/** Model has no verified inputs to project from yet. */
export function ModelUnavailable({ label = "Model projection unavailable", children }: { label?: string; children?: ReactNode }) {
  return (
    <NoticeCard icon={Cpu} title={label} tone="pending">
      {children ??
        "The structural simulation engine needs verified match inputs before it can emit a projection. No placeholder percentages are shown."}
    </NoticeCard>
  );
}

export function EmptyMatches() {
  return (
    <NoticeCard icon={Info} title="No matches to show">
      When a live provider is connected, today&apos;s ATP, WTA and Challenger fixtures
      appear here with tour, round, surface and scheduled time.
    </NoticeCard>
  );
}

export function EmptyProjections() {
  return (
    <NoticeCard icon={Database} title="No projections available">
      Projection cards populate once a live slate and verified player inputs are
      present. Probability, confidence and data-quality remain separate signals —
      none are invented.
    </NoticeCard>
  );
}

export function IdentityUnresolved() {
  return (
    <NoticeCard icon={SearchX} title="Player identity unresolved">
      This player could not be matched to a canonical identity across sources.
      Diamond Edge never joins players by name alone, so the record is withheld
      rather than guessed.
    </NoticeCard>
  );
}

export function StaleDataBadge({ label = "Historical only" }: { label?: string }) {
  return (
    <span className="inline-flex items-center gap-1 rounded-full border border-[var(--warning)]/25 bg-[var(--warning)]/12 px-2.5 py-0.5 text-xs font-medium text-[var(--warning)]">
      <Clock className="h-3 w-3" /> {label}
    </span>
  );
}

export function LoadingGrid({ count = 6, className }: { count?: number; className?: string }) {
  return (
    <div className={cn("grid gap-4 sm:grid-cols-2 lg:grid-cols-3", className)}>
      {Array.from({ length: count }).map((_, i) => (
        <Skeleton key={i} className="h-40 rounded-2xl" />
      ))}
    </div>
  );
}

export function ErrorNotice({ children }: { children?: ReactNode }) {
  return (
    <NoticeCard icon={TriangleAlert} title="Something went wrong" tone="warning">
      {children ?? "This view could not be loaded. Please retry shortly."}
    </NoticeCard>
  );
}
