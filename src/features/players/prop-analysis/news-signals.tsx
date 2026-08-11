/* ============================================================================
   News & Community Signals — the Reddit research surface in the Player Analyzer.
   It is SUPPORTING intelligence, rendered below the model/decision blocks. It is
   fetched client-side so a research failure never blocks or alters the analysis,
   and every event states its model impact ("NONE until verified"). Reddit never
   changes a projection here — this component only displays context.
   ========================================================================== */

"use client";

import { useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { Newspaper, ChevronDown, ChevronUp, Info } from "lucide-react";
import { cn } from "@/lib/utils";
import { SectionCard } from "./sections";
import type { PlayerResearch, ContextEvent } from "@/lib/research/types";

const STATUS_DOT: Record<ContextEvent["status"], string> = {
  confirmed: "🔴", reported: "🟠", unverified: "🟡", rejected: "🟢",
};
const SEVERITY_TONE: Record<ContextEvent["severity"], string> = {
  critical: "text-[var(--negative)]", high: "text-[var(--negative)]",
  medium: "text-[var(--warning)]", info: "text-muted",
};

function timeAgo(ts: number): string {
  const min = Math.round((Date.now() - ts) / 60000);
  if (min < 1) return "just now";
  if (min < 60) return `${min} min ago`;
  const hr = Math.floor(min / 60);
  return hr < 24 ? `${hr} h ago` : `${Math.floor(hr / 24)} d ago`;
}

export function NewsCommunitySignals({ playerId, modelProbMore }: { playerId: number; modelProbMore: number | null }) {
  const { data, isLoading } = useQuery({
    queryKey: ["reddit-research", playerId],
    queryFn: async () => (await fetch(`/api/research/reddit/player/${playerId}`)).json() as Promise<PlayerResearch>,
    staleTime: 5 * 60_000,
  });

  return (
    <SectionCard title="News & Community Signals" icon={<Newspaper className="h-4 w-4 text-brand-500" />} right={<span className="text-[10px] text-muted-2">Reddit · supporting intel</span>}>
      {isLoading ? (
        <p className="text-sm text-muted">Loading community signals…</p>
      ) : !data || data.status !== "available" ? (
        <p className="text-sm text-muted">
          Community signals unavailable{data?.note ? ` — ${data.note}` : ""}. Reddit is an optional early-warning source; the analysis above is unaffected.
        </p>
      ) : data.events.length === 0 && data.sentiment.status !== "available" ? (
        <p className="text-sm text-muted">No relevant community signals in the recent window.</p>
      ) : (
        <div className="space-y-3">
          {data.events.map((e) => <EventRow key={e.id} event={e} />)}
          {data.events.length === 0 && <p className="text-xs text-muted-2">No classified event signals — only general discussion below.</p>}

          {/* Community discussion + contrarian divergence */}
          {data.sentiment.status === "available" && (
            <div className="rounded-lg border border-border bg-surface-2 p-3">
              <div className="text-[11px] font-semibold uppercase tracking-wider text-muted">Community discussion</div>
              <div className="mt-1 flex flex-wrap gap-x-5 gap-y-1 text-xs">
                <span>Relevant mentions <span className="font-semibold tabular-nums">{data.sentiment.relevantMentions}</span></span>
                {data.sentiment.morePct !== undefined && <span>MORE <span className="font-semibold tabular-nums text-[var(--positive)]">{Math.round(data.sentiment.morePct * 100)}%</span></span>}
                {data.sentiment.lessPct !== undefined && <span>LESS <span className="font-semibold tabular-nums text-[var(--negative)]">{Math.round(data.sentiment.lessPct * 100)}%</span></span>}
              </div>
              {modelProbMore !== null && data.sentiment.morePct !== undefined && (
                <Divergence modelMore={modelProbMore} crowdMore={data.sentiment.morePct} />
              )}
              <p className="mt-1.5 text-[10px] text-muted-2">Community discussion is informational only — it is never fed into the model.</p>
            </div>
          )}

          <p className="flex items-start gap-1 text-[10px] leading-relaxed text-muted-2">
            <Info className="mt-px h-3 w-3 shrink-0" />
            Reddit is an early-warning/context source, not a prediction engine. Only an independently confirmed event, converted by the deterministic usage engine, can ever change a projection.
          </p>
        </div>
      )}
    </SectionCard>
  );
}

function EventRow({ event }: { event: ContextEvent }) {
  const [open, setOpen] = useState(false);
  const impact = event.status === "confirmed"
    ? (event.type === "scratch" || event.type === "pitch_limit" || event.type === "opener" || event.type === "return_from_il"
        ? "Usage model may recalculate" : "None (no deterministic rule)")
    : event.status === "rejected" ? "None (not supported)" : "NONE until verified";
  return (
    <div className="rounded-lg border border-border bg-surface-2 px-3 py-2">
      <button onClick={() => setOpen((v) => !v)} className="flex w-full items-center gap-2 text-left">
        <span>{STATUS_DOT[event.status]}</span>
        <span className={cn("text-sm font-semibold", SEVERITY_TONE[event.severity])}>{event.summary}</span>
        <span className="ml-auto text-[10px] uppercase tracking-wider text-muted-2">{event.status}</span>
        {open ? <ChevronUp className="h-3.5 w-3.5 text-muted" /> : <ChevronDown className="h-3.5 w-3.5 text-muted" />}
      </button>
      <div className="mt-1 flex flex-wrap gap-x-4 gap-y-0.5 text-[11px] text-muted">
        <span>{event.reddit.mentions} mentions</span>
        <span>{event.reddit.uniqueThreads} unique threads</span>
        <span>Source: {event.credibility.level}</span>
        <span>First seen {timeAgo(event.reddit.firstSeenAt)}</span>
      </div>
      {open && (
        <div className="mt-2 space-y-1.5 border-t border-border/60 pt-2 text-[11px]">
          <div><span className="text-muted-2">Verification:</span> {event.verificationNote ?? event.status}</div>
          <div><span className="text-muted-2">Model impact:</span> <span className="font-semibold">{impact}</span></div>
          {event.credibility.reasons.length > 0 && (
            <div className="text-muted-2">Why: {event.credibility.reasons.join(" · ")}</div>
          )}
          {event.sources.length > 0 && (
            <div className="flex flex-wrap gap-2 text-muted-2">
              {event.sources.slice(0, 4).map((s, i) => (
                <a key={i} href={s.url} target="_blank" rel="noopener noreferrer" className="underline hover:text-foreground">r/{s.subreddit}</a>
              ))}
            </div>
          )}
        </div>
      )}
    </div>
  );
}

function Divergence({ modelMore, crowdMore }: { modelMore: number; crowdMore: number }) {
  const diffPts = Math.round((crowdMore - modelMore) * 100);
  const level = Math.abs(diffPts) >= 20 ? "HIGH" : Math.abs(diffPts) >= 10 ? "MODERATE" : "LOW";
  return (
    <div className="mt-2 rounded-md border border-border bg-surface px-2.5 py-1.5 text-[11px]">
      <div className="font-semibold uppercase tracking-wider text-muted-2">Diamond Edge vs Crowd</div>
      <div className="mt-0.5 flex flex-wrap gap-x-4">
        <span>Model MORE <span className="font-semibold tabular-nums">{Math.round(modelMore * 100)}%</span></span>
        <span>Community MORE <span className="font-semibold tabular-nums">{Math.round(crowdMore * 100)}%</span></span>
        <span>Difference <span className="font-semibold tabular-nums">{diffPts > 0 ? "+" : ""}{diffPts} pts</span></span>
        <span className={cn("font-semibold", level === "HIGH" ? "text-[var(--warning)]" : "text-muted")}>Divergence: {level}</span>
      </div>
      <p className="mt-0.5 text-[10px] text-muted-2">A divergence indicator only — the crowd is not assumed correct or incorrect.</p>
    </div>
  );
}
