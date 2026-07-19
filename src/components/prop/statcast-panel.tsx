"use client";

import { Gauge, AlertCircle } from "lucide-react";
import { Card } from "@/components/ui/card";
import { cn } from "@/lib/utils";
import type { StatcastBatter, StatcastPitcher } from "@/lib/domain/models";

function Metric({
  label,
  value,
  suffix = "",
  fmt = (v: number) => v.toFixed(0),
}: {
  label: string;
  value?: number;
  suffix?: string;
  fmt?: (v: number) => string;
}) {
  const available = value !== undefined && Number.isFinite(value);
  return (
    <div className="rounded-xl border border-border bg-surface-2/40 px-3 py-2.5">
      <div className="text-[11px] font-medium uppercase tracking-wide text-muted">{label}</div>
      <div className={cn("mt-0.5 text-base font-bold tabular-nums", available ? "text-foreground" : "text-muted-2")}>
        {available ? `${fmt(value!)}${suffix}` : "N/A"}
      </div>
    </div>
  );
}

export function BatterStatcastPanel({
  batter,
  season,
}: {
  batter?: StatcastBatter | null;
  season: number;
}) {
  return (
    <Card className="p-5">
      <div className="mb-3 flex items-center gap-2">
        <Gauge className="h-4 w-4 text-brand-500" />
        <h3 className="font-semibold">Statcast · Season {season}</h3>
        <span className="ml-auto text-[11px] text-muted-2">Baseball Savant</span>
      </div>
      {batter ? (
        <div className="grid grid-cols-2 gap-2 sm:grid-cols-4">
          <Metric label="xwOBA" value={batter.xwoba} fmt={(v) => v.toFixed(3).replace(/^0/, "")} />
          <Metric label="Exit Velo" value={batter.exitVeloAvg} suffix=" mph" fmt={(v) => v.toFixed(1)} />
          <Metric label="Barrel%" value={batter.barrelPct} suffix="%" fmt={(v) => v.toFixed(1)} />
          <Metric label="Hard-Hit%" value={batter.hardHitPct} suffix="%" fmt={(v) => v.toFixed(1)} />
          <Metric label="Whiff%" value={batter.whiffPct} suffix="%" fmt={(v) => v.toFixed(1)} />
          <Metric label="K%" value={batter.kPct} suffix="%" fmt={(v) => v.toFixed(1)} />
          <Metric label="BB%" value={batter.bbPct} suffix="%" fmt={(v) => v.toFixed(1)} />
          <Metric label="Sweet-Spot%" value={batter.sweetSpotPct} suffix="%" fmt={(v) => v.toFixed(1)} />
        </div>
      ) : (
        <Unavailable msg="No qualified Statcast row for this hitter this season." />
      )}
    </Card>
  );
}

export function PitcherStatcastPanel({
  pitcher,
  season,
  title = "Statcast",
}: {
  pitcher?: StatcastPitcher | null;
  season: number;
  title?: string;
}) {
  return (
    <Card className="p-5">
      <div className="mb-3 flex items-center gap-2">
        <Gauge className="h-4 w-4 text-brand-500" />
        <h3 className="font-semibold">
          {title} · Season {season}
        </h3>
        <span className="ml-auto text-[11px] text-muted-2">Baseball Savant</span>
      </div>
      {pitcher ? (
        <div className="grid grid-cols-2 gap-2 sm:grid-cols-4">
          <Metric label="K%" value={pitcher.kPct} suffix="%" fmt={(v) => v.toFixed(1)} />
          <Metric label="BB%" value={pitcher.bbPct} suffix="%" fmt={(v) => v.toFixed(1)} />
          <Metric label="Whiff%" value={pitcher.whiffPct} suffix="%" fmt={(v) => v.toFixed(1)} />
          <Metric label="xwOBA" value={pitcher.xwoba} fmt={(v) => v.toFixed(3).replace(/^0/, "")} />
          <Metric label="FB Velo" value={pitcher.fastballVelo} suffix=" mph" fmt={(v) => v.toFixed(1)} />
          <Metric label="GB%" value={pitcher.gbPct} suffix="%" fmt={(v) => v.toFixed(1)} />
          <Metric label="Barrel%" value={pitcher.barrelPctAllowed} suffix="%" fmt={(v) => v.toFixed(1)} />
          <Metric label="Hard-Hit%" value={pitcher.hardHitPctAllowed} suffix="%" fmt={(v) => v.toFixed(1)} />
        </div>
      ) : (
        <Unavailable msg="No qualified Statcast row for this pitcher this season." />
      )}
    </Card>
  );
}

function Unavailable({ msg }: { msg: string }) {
  return (
    <div className="flex items-center gap-2 rounded-xl border border-dashed border-border p-4 text-sm text-muted">
      <AlertCircle className="h-4 w-4 shrink-0" />
      {msg}
    </div>
  );
}
