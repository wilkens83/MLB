"use client";

import { TrendingUp, TrendingDown, MinusCircle, Zap } from "lucide-react";
import { Badge, MeterBar } from "@/components/ui/primitives";
import { cn, pct, formatSigned, formatAmerican } from "@/lib/utils";
import type { PropRecommendation, PropEdge } from "@/lib/prediction/simulate";

const REC_META: Record<
  PropRecommendation["recommendation"],
  { label: string; tone: "positive" | "negative" | "default"; icon: typeof TrendingUp }
> = {
  "strong-over": { label: "Strong Over", tone: "positive", icon: TrendingUp },
  over: { label: "Lean Over", tone: "positive", icon: TrendingUp },
  pass: { label: "No Edge", tone: "default", icon: MinusCircle },
  under: { label: "Lean Under", tone: "negative", icon: TrendingDown },
  "strong-under": { label: "Strong Under", tone: "negative", icon: TrendingDown },
};

export function RecommendationCard({
  rec,
  probOver,
}: {
  rec: PropRecommendation;
  probOver: number;
}) {
  const meta = REC_META[rec.recommendation];
  const Icon = meta.icon;
  const toneClass =
    meta.tone === "positive"
      ? "text-[var(--positive)]"
      : meta.tone === "negative"
        ? "text-[var(--negative)]"
        : "text-muted";

  return (
    <div className="glass rounded-2xl p-5">
      <div className="flex items-center justify-between">
        <span className="text-xs font-medium uppercase tracking-wide text-muted">Model Signal</span>
        <Badge variant={rec.confidence >= 65 ? "brand" : "outline"} title="A 0–100 model-signal strength score — NOT the probability or certainty of the outcome.">
          <Zap className="h-3 w-3" /> Model confidence {rec.confidence}/100
        </Badge>
      </div>

      <div className={cn("mt-3 flex items-center gap-2 text-2xl font-black", toneClass)}>
        <Icon className="h-6 w-6" />
        {meta.label}
      </div>

      <div className="mt-4 space-y-2">
        <div className="flex items-center justify-between text-sm">
          <span className="text-muted">Model P(over)</span>
          <span className="font-semibold tabular-nums">{pct(probOver)}</span>
        </div>
        <MeterBar value={probOver} tone={probOver >= 0.5 ? "positive" : "negative"} />
      </div>

      <div className="mt-4 grid grid-cols-2 gap-3">
        <EdgeBox label="Over" edge={rec.over} highlight={rec.best?.side === "over"} />
        <EdgeBox label="Under" edge={rec.under} highlight={rec.best?.side === "under"} />
      </div>
    </div>
  );
}

function EdgeBox({
  label,
  edge,
  highlight,
}: {
  label: string;
  edge?: PropEdge;
  highlight?: boolean;
}) {
  if (!edge) {
    return (
      <div className="rounded-xl border border-dashed border-border p-3 text-center text-xs text-muted-2">
        {label}
        <div className="mt-1">No price set</div>
      </div>
    );
  }
  const positive = edge.ev > 0;
  return (
    <div
      className={cn(
        "rounded-xl border p-3",
        highlight && positive
          ? "border-brand-500/40 bg-brand-500/8"
          : "border-border bg-surface-2/40",
      )}
    >
      <div className="flex items-center justify-between">
        <span className="text-xs font-semibold">{label}</span>
        <span className="text-[11px] text-muted">{pct(edge.impliedProb)} impl.</span>
      </div>
      <div className="mt-1.5 space-y-1 text-xs">
        <Row k="Edge" v={pct(edge.edge)} tone={edge.edge > 0 ? "pos" : "neg"} />
        <Row k="EV" v={formatSigned(edge.ev * 100) + "%"} tone={positive ? "pos" : "neg"} />
        <Row k="Fair" v={formatAmerican(edge.fairAmerican)} />
        <Row k="¼ Kelly" v={pct(edge.kellyFraction, 1)} />
      </div>
    </div>
  );
}

function Row({ k, v, tone }: { k: string; v: string; tone?: "pos" | "neg" }) {
  return (
    <div className="flex items-center justify-between">
      <span className="text-muted">{k}</span>
      <span
        className={cn(
          "font-medium tabular-nums",
          tone === "pos" && "text-[var(--positive)]",
          tone === "neg" && "text-[var(--negative)]",
        )}
      >
        {v}
      </span>
    </div>
  );
}
