"use client";

import { useMemo, useState } from "react";
import { useQuery, keepPreviousData } from "@tanstack/react-query";
import { Loader2 } from "lucide-react";
import { Card } from "@/components/ui/card";
import { Skeleton, StatPill } from "@/components/ui/primitives";
import { TeamLogo } from "@/components/team-logo";
import { PlayerHeadshot } from "@/components/player-headshot";
import { RecommendationCard } from "@/components/prop/recommendation-card";
import { HitRateTable } from "@/components/prop/hit-rate-table";
import { BreakdownCard } from "@/components/prop/breakdown-card";
import { QualityStrip, WarningList } from "@/components/prop/quality-strip";
import { BatterStatcastPanel, PitcherStatcastPanel } from "@/components/prop/statcast-panel";
import { GameLogBars } from "@/components/charts/game-log-bars";
import { DistributionChart } from "@/components/charts/distribution-chart";
import { RollingTrend } from "@/components/charts/rolling-trend";
import { GameLogTable } from "./game-log-table";
import { SplitsPanel } from "./splits-panel";
import { MatchupPanel } from "./matchup-panel";
import { PitchMixPanel } from "./pitch-mix-panel";
import { propsByCategory, getProp } from "@/lib/props/catalog";
import { cn, pct } from "@/lib/utils";
import type { AnalysisPayload } from "@/lib/mlb/analysis";
import type { Side } from "@/lib/analytics/hitRate";

export interface WorkbenchContext {
  teamId?: number;
  teamName?: string;
  opponentId?: number;
  opponentName?: string;
  venueName?: string;
  position?: string;
  battingOrder?: number;
  lineupStatus?: string;
}

const TABS = [
  "Overview", "Props", "Statcast", "Splits", "Game Logs", "Matchup", "Pitch Mix", "Simulation", "Prediction",
] as const;
type Tab = (typeof TABS)[number];

export function PlayerWorkbench({
  playerId,
  isPitcher,
  context,
}: {
  playerId: number;
  isPitcher: boolean;
  context?: WorkbenchContext;
}) {
  const category = isPitcher ? "pitcher" : "batter";
  const props = useMemo(() => propsByCategory(category), [category]);
  const [propKey, setPropKey] = useState(isPitcher ? "strikeouts" : "hits");
  const prop = getProp(propKey)!;
  const [line, setLine] = useState<number>(prop.defaultLine);
  const [side, setSide] = useState<Side>("over");
  const [overOdds, setOverOdds] = useState("-110");
  const [underOdds, setUnderOdds] = useState("-110");
  const [tab, setTab] = useState<Tab>("Overview");

  function selectProp(key: string) {
    setPropKey(key);
    setLine(getProp(key)!.defaultLine);
  }

  const qs = new URLSearchParams({ prop: propKey, line: String(line), side, over: overOdds, under: underOdds });
  const { data, isFetching } = useQuery({
    queryKey: ["analysis", playerId, propKey, line, side, overOdds, underOdds],
    queryFn: async () =>
      (await fetch(`/api/players/${playerId}/analysis?${qs}`)).json() as Promise<AnalysisPayload>,
    placeholderData: keepPreviousData,
  });

  const analysis = data?.analysis ?? null;
  const player = data?.player;

  return (
    <div className="space-y-5">
      <Header playerId={playerId} data={data} context={context} isPitcher={isPitcher} />

      {/* Prop + market controls */}
      <Card className="p-4">
        <div className="flex flex-wrap gap-2">
          {props.map((p) => (
            <button
              key={p.key}
              onClick={() => selectProp(p.key)}
              className={cn(
                "rounded-lg px-2.5 py-1.5 text-xs font-medium transition-all",
                p.key === propKey ? "bg-brand-500 text-white" : "glass text-muted hover:text-foreground",
              )}
            >
              {p.label}
            </button>
          ))}
        </div>
        <div className="mt-3 flex flex-wrap items-end gap-3">
          <LabeledStepper label={`Line (${prop.unit})`} value={line} step={prop.step} onChange={setLine} />
          <SmallInput label="Over" value={overOdds} onChange={setOverOdds} />
          <SmallInput label="Under" value={underOdds} onChange={setUnderOdds} />
          <div>
            <div className="mb-1 text-[11px] text-muted">Side</div>
            <div className="flex h-9 rounded-lg border border-border bg-surface p-0.5">
              {(["over", "under"] as Side[]).map((s) => (
                <button
                  key={s}
                  onClick={() => setSide(s)}
                  className={cn(
                    "rounded-md px-3 text-xs font-medium capitalize",
                    side === s ? "bg-brand-500 text-white" : "text-muted",
                  )}
                >
                  {s}
                </button>
              ))}
            </div>
          </div>
          {isFetching && <Loader2 className="mb-2 h-4 w-4 animate-spin text-muted" />}
        </div>
      </Card>

      {/* Tabs */}
      <div className="flex flex-wrap gap-1 border-b border-border">
        {TABS.map((t) => (
          <button
            key={t}
            onClick={() => setTab(t)}
            className={cn(
              "relative px-3 py-2 text-sm font-medium transition-colors",
              tab === t ? "text-brand-500" : "text-muted hover:text-foreground",
            )}
          >
            {t}
            {tab === t && <span className="absolute inset-x-2 -bottom-px h-0.5 rounded-full bg-brand-500" />}
          </button>
        ))}
      </div>

      {!analysis && <Skeleton className="h-64" />}

      {analysis && data && (
        <div className="space-y-5">
          {data.dataQuality && (tab === "Overview" || tab === "Prediction") && (
            <QualityStrip quality={data.dataQuality} lastUpdated={data.lastUpdated} opponentPitcher={data.opponent?.pitcherName} />
          )}

          {tab === "Overview" && (
            <div className="grid gap-5 lg:grid-cols-3">
              <RecommendationCard rec={analysis.recommendation} probOver={analysis.simulation.probOver} />
              <Card className="lg:col-span-2 p-5">
                <h3 className="mb-3 font-semibold">Projection summary</h3>
                <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
                  <StatPill label="Projection" value={analysis.projection.lambda.toFixed(2)} tone="brand" />
                  <StatPill label="Floor (p10)" value={analysis.analytics.consistency.floor.toFixed(1)} />
                  <StatPill label="Median" value={analysis.simulation.median} />
                  <StatPill label="Ceiling (p90)" value={analysis.analytics.consistency.ceiling.toFixed(1)} />
                  <StatPill label="P(over)" value={pct(analysis.simulation.probOver)} />
                  <StatPill label="Consistency" value={`${analysis.analytics.consistency.score}`} />
                  <StatPill label="80% CI" value={`${analysis.simulation.ci80[0]}–${analysis.simulation.ci80[1]}`} />
                  <StatPill label="Model" value={analysis.modeledBy === "plate-appearance" ? "PA sim" : "Marginal"} />
                </div>
                <div className="mt-4">
                  <h4 className="mb-2 text-sm font-semibold">Hit rate vs {line}</h4>
                  <HitRateTable rows={analysis.analytics.hitRates} />
                </div>
              </Card>
            </div>
          )}

          {tab === "Props" && (
            <div className="grid gap-5 lg:grid-cols-2">
              <Card className="p-5">
                <h3 className="mb-3 font-semibold">Hit Rate vs {line}</h3>
                <HitRateTable rows={analysis.analytics.hitRates} />
              </Card>
              <Card className="p-3">
                <h3 className="mb-2 px-2 pt-2 font-semibold">Game Log ({prop.shortLabel})</h3>
                <GameLogBars samples={data.samples} line={line} side={side} unit={prop.shortLabel} />
              </Card>
              <Card className="lg:col-span-2 p-3">
                <h3 className="mb-2 px-2 pt-2 font-semibold">Rolling Trend</h3>
                <RollingTrend
                  values={analysis.analytics.series}
                  rolling5={analysis.analytics.trend.rolling5}
                  rolling10={analysis.analytics.trend.rolling10}
                  line={line}
                />
              </Card>
            </div>
          )}

          {tab === "Statcast" &&
            (isPitcher ? (
              <PitcherStatcastPanel pitcher={data.statcast.pitcher} season={data.meta.season} title={`${player?.name ?? "Pitcher"} · Statcast`} />
            ) : (
              <BatterStatcastPanel batter={data.statcast.batter} season={data.meta.season} />
            ))}

          {tab === "Splits" && <SplitsPanel playerId={playerId} />}

          {tab === "Game Logs" && <GameLogTable playerId={playerId} propKey={propKey} line={line} />}

          {tab === "Matchup" && <MatchupPanel data={data} batterHand={player?.bats} season={data.meta.season} />}

          {tab === "Pitch Mix" &&
            (isPitcher ? (
              <PitchMixPanel pitcherId={playerId} title={`${player?.name ?? "Pitcher"} · Pitch Arsenal`} />
            ) : (
              <PitchMixPanel
                pitcherId={data.opponent?.pitcherId}
                title={data.opponent?.pitcherName ? `Opp: ${data.opponent.pitcherName} · Pitch Arsenal` : "Opposing pitcher · Pitch Arsenal"}
              />
            ))}

          {tab === "Simulation" && (
            <Card className="p-5">
              <div className="mb-2 flex items-center justify-between">
                <h3 className="font-semibold">Simulated Distribution</h3>
                <span className="text-xs text-muted">{analysis.simulation.iterations.toLocaleString()} sims</span>
              </div>
              <DistributionChart distribution={analysis.simulation.distribution} line={line} continuous={prop.family === "normal"} />
              <div className="mt-4 grid grid-cols-2 gap-2 sm:grid-cols-4">
                <StatPill label="Mean" value={analysis.simulation.mean} />
                <StatPill label="Median" value={analysis.simulation.median} />
                <StatPill label="Std dev" value={analysis.simulation.stdDev} />
                <StatPill label="95% CI" value={`${analysis.simulation.ci95[0]}–${analysis.simulation.ci95[1]}`} />
              </div>
            </Card>
          )}

          {tab === "Prediction" && (
            <div className="space-y-4">
              {data.warnings.length > 0 && <WarningList warnings={data.warnings} />}
              {data.breakdown && <BreakdownCard breakdown={data.breakdown} unit={prop.shortLabel} modeledBy={analysis.modeledBy} />}
            </div>
          )}
        </div>
      )}
    </div>
  );
}

function Header({
  playerId,
  data,
  context,
  isPitcher,
}: {
  playerId: number;
  data?: AnalysisPayload;
  context?: WorkbenchContext;
  isPitcher: boolean;
}) {
  const player = data?.player;
  const opp = data?.opponent;
  return (
    <div className="glass flex flex-wrap items-center gap-4 rounded-2xl p-5">
      <PlayerHeadshot playerId={playerId} name={player?.name ?? "Player"} size={72} />
      <div className="min-w-0 flex-1">
        <div className="flex items-center gap-2">
          <h2 className="truncate text-2xl font-black tracking-tight">{player?.name ?? "Loading…"}</h2>
          {context?.battingOrder && (
            <span className="rounded-full bg-brand-500/12 px-2 py-0.5 text-xs font-semibold text-brand-500">
              #{context.battingOrder}
            </span>
          )}
        </div>
        <div className="mt-1 flex flex-wrap items-center gap-x-2 gap-y-1 text-sm text-muted">
          <span>{context?.position || player?.position}</span>
          <span className="text-muted-2">·</span>
          <span>{player?.team || context?.teamName}</span>
          {player?.bats && <span className="text-muted-2">· Bats {player.bats}</span>}
          {player?.throws && <span className="text-muted-2">· Throws {player.throws}</span>}
        </div>
      </div>
      <div className="flex items-center gap-3">
        {context?.teamId && <TeamLogo teamId={context.teamId} name={context.teamName ?? ""} size={40} />}
        <span className="text-xs text-muted">{opp?.venueName || context?.venueName}</span>
        {context?.opponentId && <TeamLogo teamId={context.opponentId} name={context.opponentName ?? ""} size={40} />}
      </div>
      <div className="w-full border-t border-border pt-3 text-xs text-muted">
        {isPitcher
          ? `Facing ${opp?.opponentTeam ?? context?.opponentName ?? "opponent"}`
          : `vs ${opp?.pitcherName ?? "TBD starter"}`}
        {context?.lineupStatus && ` · ${context.lineupStatus} lineup`}
      </div>
    </div>
  );
}

function LabeledStepper({ label, value, step, onChange }: { label: string; value: number; step: number; onChange: (v: number) => void }) {
  return (
    <div>
      <div className="mb-1 text-[11px] text-muted">{label}</div>
      <div className="flex items-center">
        <button className="grid h-9 w-8 place-items-center rounded-l-lg border border-border bg-surface-2" onClick={() => onChange(Math.max(0, +(value - step).toFixed(1)))}>−</button>
        <input type="number" step={step} value={value} onChange={(e) => onChange(Number(e.target.value))} className="h-9 w-16 border-y border-border bg-surface px-2 text-center text-sm tabular-nums outline-none" />
        <button className="grid h-9 w-8 place-items-center rounded-r-lg border border-border bg-surface-2" onClick={() => onChange(+(value + step).toFixed(1))}>+</button>
      </div>
    </div>
  );
}

function SmallInput({ label, value, onChange }: { label: string; value: string; onChange: (v: string) => void }) {
  return (
    <div>
      <div className="mb-1 text-[11px] text-muted">{label}</div>
      <input value={value} onChange={(e) => onChange(e.target.value)} className="h-9 w-20 rounded-lg border border-border bg-surface px-2 text-center text-sm tabular-nums outline-none" />
    </div>
  );
}
