"use client";

import { useMemo, useState } from "react";
import { useQuery, keepPreviousData } from "@tanstack/react-query";
import { Loader2, SlidersHorizontal, BarChart3, Dice5, Activity, Home, Plane } from "lucide-react";
import { Card } from "@/components/ui/card";
import { Badge, Skeleton, StatPill } from "@/components/ui/primitives";
import { RecommendationCard } from "./recommendation-card";
import { HitRateTable } from "./hit-rate-table";
import { GameLogBars } from "@/components/charts/game-log-bars";
import { DistributionChart } from "@/components/charts/distribution-chart";
import { RollingTrend } from "@/components/charts/rolling-trend";
import { propsByCategory, getProp, type PropCategory } from "@/lib/props/catalog";
import { cn } from "@/lib/utils";
import type { AnalysisPayload } from "@/lib/mlb/analysis";
import type { Side } from "@/lib/analytics/hitRate";

const DISPLAY_WINDOWS = [
  { key: 10, label: "L10" },
  { key: 15, label: "L15" },
  { key: 20, label: "L20" },
  { key: 30, label: "L30" },
  { key: 0, label: "Season" },
];

export function PropDashboard({
  playerId,
  categories,
  initialProp,
}: {
  playerId: number;
  categories: PropCategory[];
  initialProp: string;
}) {
  const availableProps = useMemo(
    () => categories.flatMap((c) => propsByCategory(c)),
    [categories],
  );

  const [propKey, setPropKey] = useState(initialProp);
  const [side, setSide] = useState<Side>("over");
  const [venue, setVenue] = useState<"all" | "home" | "away">("all");
  const [displayWindow, setDisplayWindow] = useState(15);

  const prop = getProp(propKey)!;
  const [line, setLine] = useState<number>(prop.defaultLine);
  const [overOdds, setOverOdds] = useState<string>("-110");
  const [underOdds, setUnderOdds] = useState<string>("-110");

  // When switching props, reset the line to that prop's default.
  function selectProp(key: string) {
    setPropKey(key);
    setLine(getProp(key)!.defaultLine);
  }

  const params = new URLSearchParams({
    prop: propKey,
    line: String(line),
    side,
    over: overOdds,
    under: underOdds,
    ...(venue !== "all" ? { venue } : {}),
  });

  const { data, isFetching, isError } = useQuery({
    queryKey: ["analysis", playerId, propKey, line, side, venue, overOdds, underOdds],
    queryFn: async () => {
      const res = await fetch(`/api/players/${playerId}/analysis?${params.toString()}`);
      if (!res.ok) throw new Error("analysis failed");
      return (await res.json()) as AnalysisPayload;
    },
    placeholderData: keepPreviousData,
  });

  const analysis = data?.analysis ?? null;
  const samples = data?.samples ?? [];
  const shownSamples = displayWindow > 0 ? samples.slice(-displayWindow) : samples;

  return (
    <div className="space-y-5">
      {/* Prop selector */}
      <div className="flex flex-wrap gap-2">
        {availableProps.map((p) => (
          <button
            key={p.key}
            onClick={() => selectProp(p.key)}
            className={cn(
              "rounded-lg px-3 py-1.5 text-sm font-medium transition-all",
              p.key === propKey
                ? "bg-brand-500 text-white shadow-[0_4px_14px_-4px_rgba(249,115,22,0.6)]"
                : "glass text-muted hover:text-foreground",
            )}
          >
            {p.label}
          </button>
        ))}
      </div>

      {/* Controls */}
      <Card className="p-4">
        <div className="flex items-center gap-2 text-xs font-semibold uppercase tracking-wide text-muted">
          <SlidersHorizontal className="h-3.5 w-3.5" /> Market &amp; Filters
        </div>
        <div className="mt-3 grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-6">
          <Field label={`Line (${prop.unit})`}>
            <div className="flex items-center">
              <button
                className="grid h-9 w-8 place-items-center rounded-l-lg border border-border bg-surface-2 text-lg"
                onClick={() => setLine((l) => Math.max(0, +(l - prop.step).toFixed(1)))}
                aria-label="decrease line"
              >
                −
              </button>
              <input
                type="number"
                step={prop.step}
                value={line}
                onChange={(e) => setLine(Number(e.target.value))}
                className="h-9 w-full border-y border-border bg-surface px-2 text-center text-sm tabular-nums outline-none"
              />
              <button
                className="grid h-9 w-8 place-items-center rounded-r-lg border border-border bg-surface-2 text-lg"
                onClick={() => setLine((l) => +(l + prop.step).toFixed(1))}
                aria-label="increase line"
              >
                +
              </button>
            </div>
          </Field>
          <Field label="Over odds">
            <OddsInput value={overOdds} onChange={setOverOdds} />
          </Field>
          <Field label="Under odds">
            <OddsInput value={underOdds} onChange={setUnderOdds} />
          </Field>
          <Field label="Side">
            <Segmented
              options={[
                { key: "over", label: "Over" },
                { key: "under", label: "Under" },
              ]}
              value={side}
              onChange={(v) => setSide(v as Side)}
            />
          </Field>
          <Field label="Venue">
            <Segmented
              options={[
                { key: "all", label: "All", icon: Activity },
                { key: "home", label: "Home", icon: Home },
                { key: "away", label: "Away", icon: Plane },
              ]}
              value={venue}
              onChange={(v) => setVenue(v as typeof venue)}
            />
          </Field>
          <Field label="Window">
            <select
              value={displayWindow}
              onChange={(e) => setDisplayWindow(Number(e.target.value))}
              className="h-9 w-full rounded-lg border border-border bg-surface px-2 text-sm outline-none"
            >
              {DISPLAY_WINDOWS.map((w) => (
                <option key={w.key} value={w.key}>
                  {w.label}
                </option>
              ))}
            </select>
          </Field>
        </div>
      </Card>

      {isError && (
        <Card className="p-6 text-center text-sm text-[var(--negative)]">
          Could not load analysis for this prop. The player may not have game-log data this season.
        </Card>
      )}

      {!analysis && !isError && <DashboardSkeleton />}

      {analysis && (
        <>
          {data?.meta && data.meta.sampleSize < 4 && (
            <Badge variant="warning">
              Small sample ({data.meta.sampleSize} games) — projection regressed to prior.
            </Badge>
          )}

          <div className="grid gap-5 lg:grid-cols-3">
            <div className="lg:col-span-1">
              <RecommendationCard rec={analysis.recommendation} probOver={analysis.simulation.probOver} />
            </div>

            <Card className="lg:col-span-2">
              <div className="flex items-center justify-between p-5 pb-2">
                <h3 className="flex items-center gap-2 font-semibold">
                  <Dice5 className="h-4 w-4 text-brand-500" /> Simulated Distribution
                  {isFetching && <Loader2 className="h-3.5 w-3.5 animate-spin text-muted" />}
                </h3>
                <span className="text-xs text-muted">{analysis.simulation.iterations.toLocaleString()} sims</span>
              </div>
              <div className="px-3 pb-4">
                <DistributionChart
                  distribution={analysis.simulation.distribution}
                  line={line}
                  continuous={prop.family === "normal"}
                />
              </div>
              <div className="grid grid-cols-4 gap-2 border-t border-border p-4">
                <StatPill label="Proj μ" value={analysis.projection.lambda.toFixed(2)} tone="brand" />
                <StatPill label="Median" value={analysis.simulation.median} />
                <StatPill label="80% CI" value={`${analysis.simulation.ci80[0]}–${analysis.simulation.ci80[1]}`} />
                <StatPill label="Context" value={`×${analysis.projection.contextMultiplier.toFixed(2)}`} />
              </div>
            </Card>
          </div>

          <div className="grid gap-5 lg:grid-cols-2">
            <Card>
              <div className="p-5 pb-3">
                <h3 className="flex items-center gap-2 font-semibold">
                  <BarChart3 className="h-4 w-4 text-brand-500" /> Hit Rate vs {line}
                </h3>
                <p className="text-xs text-muted">Share of games clearing the line ({side}).</p>
              </div>
              <div className="px-5 pb-5">
                <HitRateTable rows={analysis.analytics.hitRates} />
              </div>
            </Card>

            <Card>
              <div className="flex items-center justify-between p-5 pb-3">
                <h3 className="font-semibold">Game Log</h3>
                <span className="text-xs text-muted">
                  last {shownSamples.length} · streak{" "}
                  <span className={analysis.analytics.streak.current >= 0 ? "text-[var(--positive)]" : "text-[var(--negative)]"}>
                    {analysis.analytics.streak.current > 0 ? `${analysis.analytics.streak.current}O` : `${Math.abs(analysis.analytics.streak.current)}U`}
                  </span>
                </span>
              </div>
              <div className="px-3 pb-4">
                <GameLogBars samples={shownSamples} line={line} side={side} unit={prop.shortLabel} />
              </div>
            </Card>
          </div>

          <Card>
            <div className="p-5 pb-3">
              <h3 className="font-semibold">Rolling Trend</h3>
              <p className="text-xs text-muted">
                5- and 10-game moving averages ·{" "}
                <span className="text-foreground">form {(analysis.analytics.trend.formRatio * 100 - 100).toFixed(0)}%</span>{" "}
                vs season · direction {analysis.analytics.trend.direction}
              </p>
            </div>
            <div className="px-3 pb-4">
              <RollingTrend
                values={analysis.analytics.series}
                rolling5={analysis.analytics.trend.rolling5}
                rolling10={analysis.analytics.trend.rolling10}
                line={line}
              />
            </div>
            <div className="grid grid-cols-2 gap-2 border-t border-border p-4 sm:grid-cols-4">
              <StatPill label="Consistency" value={`${analysis.analytics.consistency.score}`} hint="0–100" tone="brand" />
              <StatPill label="Floor (p10)" value={analysis.analytics.consistency.floor.toFixed(1)} />
              <StatPill label="Ceiling (p90)" value={analysis.analytics.consistency.ceiling.toFixed(1)} />
              <StatPill label="Line pctile" value={`${analysis.analytics.lineDifficulty}`} hint="of games below line" />
            </div>
          </Card>
        </>
      )}
    </div>
  );
}

function Field({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <label className="block">
      <span className="mb-1 block text-[11px] font-medium text-muted">{label}</span>
      {children}
    </label>
  );
}

function OddsInput({ value, onChange }: { value: string; onChange: (v: string) => void }) {
  return (
    <input
      value={value}
      onChange={(e) => onChange(e.target.value)}
      inputMode="numeric"
      className="h-9 w-full rounded-lg border border-border bg-surface px-2 text-center text-sm tabular-nums outline-none"
      placeholder="-110"
    />
  );
}

function Segmented({
  options,
  value,
  onChange,
}: {
  options: { key: string; label: string; icon?: typeof Home }[];
  value: string;
  onChange: (v: string) => void;
}) {
  return (
    <div className="flex h-9 items-center rounded-lg border border-border bg-surface p-0.5">
      {options.map((o) => (
        <button
          key={o.key}
          onClick={() => onChange(o.key)}
          className={cn(
            "flex h-full flex-1 items-center justify-center gap-1 rounded-md text-xs font-medium transition-colors",
            value === o.key ? "bg-brand-500 text-white" : "text-muted hover:text-foreground",
          )}
        >
          {o.icon && <o.icon className="h-3 w-3" />}
          {o.label}
        </button>
      ))}
    </div>
  );
}

function DashboardSkeleton() {
  return (
    <div className="space-y-5">
      <div className="grid gap-5 lg:grid-cols-3">
        <Skeleton className="h-64 lg:col-span-1" />
        <Skeleton className="h-64 lg:col-span-2" />
      </div>
      <div className="grid gap-5 lg:grid-cols-2">
        <Skeleton className="h-56" />
        <Skeleton className="h-56" />
      </div>
    </div>
  );
}
