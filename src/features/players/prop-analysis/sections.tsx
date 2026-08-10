/* ============================================================================
   Presentational sections for the player-prop research page. Each renders a
   slice of the server-assembled view model. No scientific calculation happens
   here — every number is read from the view model, and every missing value is
   shown as an explicit unavailable/N/A state.
   ========================================================================== */

"use client";

import { Info, TrendingUp, ShieldCheck, CircleAlert, MapPin } from "lucide-react";
import { cn } from "@/lib/utils";
import { formatMetric, formatDelta, pctStr } from "./format";
import type {
  VmMetric, VmHistoricalHitRate, VmScientific, VmDecision, VmConditions, VmMatchup, VmPitchType,
  VmPercentileRow, VmOpponentContext, VmSplit,
} from "@/lib/players/prop-analysis/types";

/* ------------------------------ header metrics ---------------------------- */

export function HeaderMetrics({ metrics }: { metrics: VmMetric[] }) {
  if (metrics.length === 0) return null;
  return (
    <div className="flex flex-wrap gap-x-5 gap-y-2">
      {metrics.map((m) => {
        const delta = formatDelta(m);
        return (
          <div key={m.key} className="min-w-[52px]">
            <div className="text-[10px] font-medium uppercase tracking-wider text-muted-2">{m.label}</div>
            <div className="text-sm font-bold tabular-nums leading-tight">{formatMetric(m)}</div>
            {delta && (
              <div className={cn("text-[10px] font-medium tabular-nums", delta.good ? "text-[var(--positive)]" : "text-[var(--negative)]")}>
                {delta.text} vs season
              </div>
            )}
          </div>
        );
      })}
    </div>
  );
}

/* --------------------------- historical hit rates ------------------------- */

export function HitRateWindows({ rates, line, unit }: { rates: VmHistoricalHitRate[]; line: number; unit: string }) {
  return (
    <div>
      <div className="mb-2 flex items-center gap-1.5">
        <span className="text-[11px] font-semibold uppercase tracking-wider text-muted">Historical Over Rate</span>
        <span className="rounded border border-border bg-surface-2 px-1.5 py-0.5 text-[9px] font-medium text-muted-2">
          {unit} vs {line} · not a probability
        </span>
      </div>
      <div className="grid grid-cols-4 gap-2">
        {rates.map((r) => (
          <div key={r.window} className="rounded-lg border border-border bg-surface-2 px-2 py-1.5 text-center">
            <div className="text-[10px] uppercase tracking-wider text-muted-2">{r.window}</div>
            <div className="text-sm font-bold tabular-nums">{r.overRate === null ? "—" : pctStr(r.overRate, 0)}</div>
            <div className="text-[10px] text-muted-2">{r.hits}/{r.games}</div>
          </div>
        ))}
      </div>
    </div>
  );
}

/* ------------------------------- model block ------------------------------ */

function Stat({ label, value, hint, tone }: { label: string; value: string; hint?: string; tone?: "good" | "bad" | "muted" }) {
  return (
    <div className="flex items-baseline justify-between gap-2 border-b border-border/50 py-1.5 last:border-0">
      <span className="text-xs text-muted">{label}</span>
      <span className={cn("text-sm font-semibold tabular-nums", tone === "good" && "text-[var(--positive)]", tone === "bad" && "text-[var(--negative)]", tone === "muted" && "text-muted-2")}>
        {value}{hint && <span className="ml-1 text-[10px] font-normal text-muted-2">{hint}</span>}
      </span>
    </div>
  );
}

export function ModelBlock({ sci }: { sci: VmScientific | null }) {
  if (!sci) {
    return (
      <SectionCard title="Diamond Edge Model" icon={<TrendingUp className="h-4 w-4 text-brand-500" />}>
        <p className="text-sm text-muted">Model output unavailable — no projection for this market/sample.</p>
      </SectionCard>
    );
  }
  const sideLabel = sci.side === "more" ? "More" : "Less";
  const rawSel = sci.side === "more" ? sci.rawProbabilityMore : sci.rawProbabilityLess;
  const calSel = sci.side === "more" ? sci.calibratedProbabilityMore : sci.calibratedProbabilityLess;
  return (
    <SectionCard
      title="Diamond Edge Model"
      icon={<TrendingUp className="h-4 w-4 text-brand-500" />}
      right={<span className="rounded border border-border bg-surface-2 px-1.5 py-0.5 text-[10px] font-medium text-muted-2">{sci.modelVersion}</span>}
    >
      <div className="grid gap-x-6 gap-y-0 sm:grid-cols-2">
        <div>
          <Stat label={`Raw P(${sideLabel})`} value={pctStr(rawSel)} />
          <Stat
            label={`Calibrated P(${sideLabel})`}
            value={calSel === null ? "Unavailable" : pctStr(calSel)}
            tone={calSel === null ? "muted" : undefined}
            hint={calSel === null ? "no fit" : sci.calibrationVersion ?? undefined}
          />
          <Stat label={`Baseline P(${sideLabel})`} value={sci.baselineProbability === null ? "—" : pctStr(sci.baselineProbability)} />
          <Stat
            label="Model Advantage"
            value={sci.modelAdvantagePp === null ? "N/A" : `${sci.modelAdvantagePp > 0 ? "+" : ""}${sci.modelAdvantagePp} pp`}
            tone={sci.modelAdvantagePp === null ? "muted" : sci.modelAdvantagePp > 0 ? "good" : "bad"}
            hint={sci.modelAdvantagePp === null ? "needs calibration" : undefined}
          />
          <Stat label="Policy Threshold" value={`${sci.policyThresholdPct}%`} tone="muted" />
        </div>
        <div>
          <Stat label="Projection" value={`${sci.projection.mean}`} />
          <Stat label="Median" value={`${sci.projection.median}`} />
          {sci.projection.iqr && <Stat label="P25–P75" value={`${sci.projection.iqr[0]}–${sci.projection.iqr[1]}`} />}
          <Stat label={sci.projection.bandLabel} value={`${sci.projection.band[0]}–${sci.projection.band[1]}`} />
          <Stat label="Uncertainty (±95%)" value={sci.uncertaintyHalfWidth95 === null ? "—" : `±${(sci.uncertaintyHalfWidth95 * 100).toFixed(1)}pp`} hint="sampling" />
          <Stat label="Assumption swing" value={sci.modelInputUncertainty === null ? "—" : `±${(sci.modelInputUncertainty * 100).toFixed(1)}pp`} hint="fragility" />
        </div>
      </div>
      <div className="mt-3 flex flex-wrap gap-2">
        <Chip label="Data Quality" value={`${sci.dataQuality}/100`} />
        <Chip label="Volatility" value={`${sci.volatility}/100`} />
        <Chip label="Fragility" value={sci.fragilityLevel ?? "—"} tone={sci.fragilityLevel === "LOW" ? "good" : sci.fragilityLevel === "HIGH" || sci.fragilityLevel === "EXTREME" ? "bad" : "neutral"} />
        <Chip label="Training" value={sci.trainingSupport} />
        <Chip label="Lifecycle" value={sci.modelLifecycle} />
      </div>
      {/* Parallel models + ensemble + disagreement (deterministic; never an LLM). */}
      {sci.models.length > 0 && (
        <div className="mt-3 rounded-lg border border-border bg-surface-2 p-2.5">
          <div className="mb-1.5 flex items-center justify-between">
            <span className="text-[11px] font-semibold uppercase tracking-wider text-muted">Parallel Models</span>
            <DisagreementBadge severity={sci.disagreement.severity} range={sci.disagreement.probabilityRange} />
          </div>
          <div className="space-y-0.5">
            {sci.models.map((m) => (
              <div key={m.id} className="grid grid-cols-[auto_1fr_auto_auto] items-center gap-2 text-[11px]">
                <span className="w-16 font-medium capitalize">{m.id}</span>
                <span className="text-muted-2">proj <span className="tabular-nums text-foreground">{m.projection}</span></span>
                <span className="tabular-nums text-muted">{pctStr(m.probOver)}</span>
                <span className="w-10 text-right text-[10px] text-muted-2">{m.weight === null ? "—" : `w ${(m.weight * 100).toFixed(0)}%`}</span>
              </div>
            ))}
            {sci.ensembleProbOver !== null && (
              <div className="mt-1 grid grid-cols-[auto_1fr_auto_auto] items-center gap-2 border-t border-border/60 pt-1 text-[11px] font-semibold">
                <span className="w-16">Ensemble</span>
                <span className="text-muted-2">v{sci.ensembleVersion}</span>
                <span className="tabular-nums text-brand-500">{pctStr(sci.ensembleProbOver)}</span>
                <span />
              </div>
            )}
          </div>
        </div>
      )}
      <div className="mt-1.5 flex flex-wrap gap-2 text-[10px] text-muted-2">
        <span>model {sci.modelVersion}</span><span>·</span>
        <span>features {sci.featureVersion}</span><span>·</span>
        <span>calibration {sci.calibrationVersion ?? "none"}</span>
      </div>
      <p className="mt-2 flex items-start gap-1 text-[10px] leading-relaxed text-muted-2">
        <Info className="mt-px h-3 w-3 shrink-0" />
        Probability, Data Quality (completeness), Calibration, Uncertainty (sampling), Fragility (assumption swing) and Support are kept separate — never compressed into one score. Calibrated is shown only when a fit exists; raw is never relabeled.
      </p>
    </SectionCard>
  );
}

function DisagreementBadge({ severity, range }: { severity: "low" | "medium" | "high"; range: number }) {
  const tone = severity === "low" ? "border-[var(--positive)]/30 text-[var(--positive)]"
    : severity === "high" ? "border-[var(--negative)]/30 text-[var(--negative)]" : "border-[var(--warning)]/30 text-[var(--warning)]";
  return (
    <span className={cn("inline-flex items-center gap-1 rounded-md border px-1.5 py-0.5 text-[10px] font-medium capitalize", tone)}>
      Disagreement: {severity}
      <span className="text-muted-2">±{(range * 100).toFixed(0)}pp</span>
    </span>
  );
}

function Chip({ label, value, tone = "neutral" }: { label: string; value: string; tone?: "good" | "bad" | "neutral" }) {
  return (
    <span className={cn(
      "inline-flex items-center gap-1 rounded-md border px-2 py-0.5 text-[11px]",
      tone === "good" && "border-[var(--positive)]/30 bg-[var(--positive)]/10 text-[var(--positive)]",
      tone === "bad" && "border-[var(--negative)]/30 bg-[var(--negative)]/10 text-[var(--negative)]",
      tone === "neutral" && "border-border bg-surface-2 text-muted",
    )}>
      <span className="text-muted-2">{label}</span>
      <span className="font-semibold">{value}</span>
    </span>
  );
}

/* ------------------------------- decision --------------------------------- */

const DECISION_TONE: Record<VmDecision["status"], { label: string; cls: string }> = {
  QUALIFIED_MORE: { label: "Qualified · More", cls: "border-[var(--positive)]/40 bg-[var(--positive)]/10 text-[var(--positive)]" },
  QUALIFIED_LESS: { label: "Qualified · Less", cls: "border-[var(--positive)]/40 bg-[var(--positive)]/10 text-[var(--positive)]" },
  WATCH: { label: "Watch", cls: "border-[var(--warning)]/40 bg-[var(--warning)]/10 text-[var(--warning)]" },
  NO_PLAY: { label: "No Play", cls: "border-[var(--negative)]/40 bg-[var(--negative)]/10 text-[var(--negative)]" },
  UNAVAILABLE: { label: "Unavailable", cls: "border-border bg-surface-2 text-muted" },
  NO_ACTIVE_LINE: { label: "No Active Line", cls: "border-border bg-surface-2 text-muted" },
};

export function DecisionBlock({ decision, sci }: { decision: VmDecision; sci: VmScientific | null }) {
  const tone = DECISION_TONE[decision.status];
  const calSel = sci ? (sci.side === "more" ? sci.calibratedProbabilityMore : sci.calibratedProbabilityLess) : null;
  return (
    <SectionCard title="Scientific Decision" icon={<ShieldCheck className="h-4 w-4 text-brand-500" />}>
      <div className={cn("inline-flex items-center gap-2 rounded-lg border px-3 py-1.5 text-sm font-bold", tone.cls)}>
        {tone.label}
      </div>
      {!decision.fromCanonicalAssessment && (
        <p className="mt-2 text-[11px] text-muted-2">
          {decision.status === "NO_ACTIVE_LINE"
            ? "Enter a PrizePicks/market line to evaluate a canonical decision."
            : "Not a canonical BET verdict."}
        </p>
      )}

      {/* Fact strip — the scientific basis of the verdict. */}
      {sci && (
        <div className="mt-3 grid grid-cols-2 gap-x-4 gap-y-1 sm:grid-cols-3">
          <Fact label="Calibrated P" value={calSel === null ? "Unavailable" : pctStr(calSel)} />
          <Fact label="Threshold" value={`${sci.policyThresholdPct}%`} />
          <Fact label="Advantage" value={sci.modelAdvantagePp === null ? "N/A" : `${sci.modelAdvantagePp > 0 ? "+" : ""}${sci.modelAdvantagePp} pp`} />
          <Fact label="Fragility" value={sci.fragilityLevel ?? "—"} />
          <Fact label="Data Quality" value={`${sci.dataQuality}/100`} />
          <Fact label="Lifecycle" value={sci.modelLifecycle} />
          <Fact label="Training" value={sci.trainingSupport} />
        </div>
      )}

      {decision.reasons.length > 0 && (
        <div className="mt-3">
          <div className="text-[11px] font-semibold uppercase tracking-wider text-[var(--positive)]">Positive Evidence</div>
          <ul className="mt-1 space-y-0.5">
            {decision.reasons.map((r, i) => (
              <li key={i} className="flex items-start gap-1.5 text-xs text-text-secondary">
                <span className="mt-1 text-[var(--positive)]">+</span>{r}
              </li>
            ))}
          </ul>
        </div>
      )}
      {decision.risks.length > 0 && (
        <div className="mt-3">
          <div className="flex items-center gap-1 text-[11px] font-semibold uppercase tracking-wider text-[var(--warning)]">
            <CircleAlert className="h-3 w-3" /> Blockers / Risks
          </div>
          <ul className="mt-1 space-y-0.5">
            {decision.risks.map((r, i) => (
              <li key={i} className="flex items-start gap-1.5 text-xs text-muted">
                <span className="mt-0.5 text-[var(--warning)]">−</span>{r}
              </li>
            ))}
          </ul>
        </div>
      )}
      <div className="mt-3 rounded-lg border border-border bg-surface-2 px-2.5 py-2">
        <div className="text-[10px] font-semibold uppercase tracking-wider text-muted-2">Next Review</div>
        <div className="text-xs text-text-secondary">{decision.nextReview}</div>
      </div>
    </SectionCard>
  );
}

function Fact({ label, value }: { label: string; value: string }) {
  return (
    <div>
      <div className="text-[10px] uppercase tracking-wider text-muted-2">{label}</div>
      <div className="text-xs font-semibold tabular-nums">{value}</div>
    </div>
  );
}

/* ------------------------------ conditions -------------------------------- */

export function ConditionsRow({ conditions }: { conditions: VmConditions | null }) {
  if (!conditions) {
    return (
      <div className="panel flex items-center gap-2 px-4 py-2.5 text-xs text-muted">
        <MapPin className="h-3.5 w-3.5" /> Game conditions unavailable — no resolved game today.
      </div>
    );
  }
  const pf = conditions.park;
  return (
    <div className="panel flex flex-wrap items-center gap-x-5 gap-y-2 px-4 py-2.5 text-xs">
      <span className="inline-flex items-center gap-1.5 font-semibold">
        <MapPin className="h-3.5 w-3.5 text-brand-500" />{conditions.venueName}
      </span>
      <span className="text-muted">
        Weather: {conditions.weatherAvailable ? `${conditions.temperatureF}°F · ${conditions.windDescription}` : <span className="text-muted-2">unavailable</span>}
      </span>
      <span className="text-muted">
        Roof: {conditions.roof === "unavailable" ? <span className="text-muted-2">unavailable</span> : <span className="capitalize">{conditions.roof}</span>}
      </span>
      <span className="flex items-center gap-2">
        <Park label="HR" v={pf.hr} />
        <Park label="Runs" v={pf.runs} />
        <Park label="Hits" v={pf.hits} />
      </span>
      {conditions.classification && (
        <span className={cn(
          "rounded-md border px-1.5 py-0.5 font-medium",
          conditions.classification === "Hitter Friendly" ? "border-[var(--positive)]/30 text-[var(--positive)]"
            : conditions.classification === "Pitcher Friendly" ? "border-brand-500/30 text-brand-500" : "border-border text-muted",
        )}>
          {conditions.classification}
        </span>
      )}
    </div>
  );
}

function Park({ label, v }: { label: string; v: number | null }) {
  if (v === null) return <span className="text-muted-2">{label} N/A</span>;
  const pct = Math.round((v - 1) * 100);
  return (
    <span className="text-muted">
      {label} <span className={cn("font-semibold tabular-nums", pct > 0 ? "text-[var(--positive)]" : pct < 0 ? "text-[var(--negative)]" : "text-muted")}>
        {pct > 0 ? "+" : ""}{pct}%
      </span>
    </span>
  );
}

/* ------------------------- percentile matchup ----------------------------- */

export function MatchupPercentiles({ matchup }: { matchup: VmMatchup }) {
  if (!matchup.available) {
    return (
      <SectionCard title="Percentile Matchup">
        <p className="text-sm text-muted">{matchup.note ?? "Matchup profile unavailable."}</p>
      </SectionCard>
    );
  }
  return (
    <SectionCard title="Percentile Matchup" right={<span className="text-[10px] text-muted-2">Player edge ← → Opponent edge</span>}>
      <div className="mb-2 grid grid-cols-[minmax(0,1fr)_120px_minmax(0,1fr)] items-center gap-2 text-[11px] font-semibold uppercase tracking-wider text-muted">
        <span className="text-right">{matchup.leftLabel}</span>
        <span className="text-center text-muted-2">Advantage</span>
        <span>{matchup.rightLabel}</span>
      </div>
      <div className="space-y-1.5">
        {matchup.rows.map((r) => (
          <div key={r.metric} className="grid grid-cols-[minmax(0,1fr)_120px_minmax(0,1fr)] items-center gap-2 text-xs">
            <SideCell value={r.playerValue} pct={r.playerPercentile} align="right" />
            <div className="flex flex-col items-center">
              <span className="text-[10px] font-medium uppercase tracking-wider text-muted-2">{r.label}</span>
              <EdgeBar edge={r.edge} />
            </div>
            <SideCell value={r.opponentValue} pct={r.opponentPercentile} align="left" />
          </div>
        ))}
      </div>
      {matchup.note && <p className="mt-2 flex items-start gap-1 text-[10px] leading-relaxed text-muted-2"><Info className="mt-px h-3 w-3 shrink-0" />{matchup.note}</p>}
    </SectionCard>
  );
}

function SideCell({ value, pct, align }: { value: number | null; pct: number | null; align: "left" | "right" }) {
  return (
    <div className={cn("flex items-center gap-1.5", align === "right" ? "justify-end" : "justify-start")}>
      {align === "left" && <PctBadge pct={pct} />}
      <span className="tabular-nums">{value === null ? "—" : fmtVal(value)}</span>
      {align === "right" && <PctBadge pct={pct} />}
    </div>
  );
}

function PctBadge({ pct }: { pct: number | null }) {
  if (pct === null) return <span className="rounded bg-surface-2 px-1 text-[9px] text-muted-2">N/A</span>;
  const tone = pct >= 70 ? "text-[var(--positive)]" : pct <= 30 ? "text-[var(--negative)]" : "text-muted";
  return <span className={cn("rounded bg-surface-2 px-1 text-[9px] font-semibold tabular-nums", tone)}>{pct}</span>;
}

function EdgeBar({ edge }: { edge: VmPercentileRow["edge"] }) {
  // Player = left, opponent = right. Note: "pitcher"/"batter" map to whichever
  // side is the analyzed player; the container passes perspective via labels.
  return (
    <div className="mt-0.5 flex h-1.5 w-full overflow-hidden rounded-full bg-surface-2">
      <span className={cn("h-full flex-1", edge === "pitcher" ? "bg-brand-500" : "bg-transparent")} />
      <span className={cn("h-full w-3", edge === "neutral" ? "bg-muted-2" : "bg-transparent")} />
      <span className={cn("h-full flex-1", edge === "batter" ? "bg-[var(--positive)]" : "bg-transparent")} />
    </div>
  );
}

function fmtVal(v: number): string {
  if (v > 0 && v < 1) return v.toFixed(3);
  return v.toFixed(v >= 100 ? 0 : 1);
}

/* ------------------------- opponent context ------------------------------- */

export function OpponentContextSection({ opponent }: { opponent: VmOpponentContext }) {
  if (opponent.kind === "unavailable") {
    return (
      <SectionCard title="Opponent Context">
        <p className="text-sm text-muted">{opponent.note ?? "Opponent context unavailable."}</p>
      </SectionCard>
    );
  }
  const statusChip = (label: string, status: string) => (
    <span className={cn(
      "rounded-md border px-1.5 py-0.5 text-[10px] font-medium",
      status === "confirmed" ? "border-[var(--positive)]/30 text-[var(--positive)]"
        : status === "projected" ? "border-[var(--warning)]/30 text-[var(--warning)]" : "border-border text-muted-2",
    )}>{label}: {status}</span>
  );
  return (
    <SectionCard title="Opponent Context" right={<span className="text-[10px] text-muted-2">{opponent.team}</span>}>
      <div className="mb-2 flex flex-wrap items-center gap-2">
        {opponent.kind === "starter" && opponent.starterName && (
          <span className="text-sm font-semibold">{opponent.starterName}{opponent.starterHand ? ` · ${opponent.starterHand}HP` : ""}</span>
        )}
        {opponent.kind === "lineup" && <span className="text-sm font-semibold">Opposing lineup (aggregate)</span>}
        {opponent.kind === "starter" && opponent.starterStatus && statusChip("Starter", opponent.starterStatus)}
        {statusChip("Lineup", opponent.lineupStatus)}
      </div>
      {opponent.metrics.length > 0 ? (
        <div className="flex flex-wrap gap-x-5 gap-y-2">
          {opponent.metrics.map((m) => (
            <div key={m.key}>
              <div className="text-[10px] uppercase tracking-wider text-muted-2">{m.label}</div>
              <div className="text-sm font-bold tabular-nums">{formatMetric(m)}</div>
            </div>
          ))}
        </div>
      ) : (
        <p className="text-xs text-muted-2">{opponent.note ?? "Statcast profile unavailable."}</p>
      )}
    </SectionCard>
  );
}

/* ------------------------------- splits ----------------------------------- */

export function SplitsSection({ splits }: { splits: VmSplit[] }) {
  if (splits.length === 0) return null;
  return (
    <SectionCard title="Splits" right={<span className="text-[10px] text-muted-2">Situational</span>}>
      <div className="grid grid-cols-1 gap-2 sm:grid-cols-2">
        {splits.map((s) => (
          <div key={s.key} className="rounded-lg border border-border bg-surface-2 px-3 py-2">
            <div className="mb-1 flex items-center justify-between">
              <span className="text-xs font-semibold">{s.label}</span>
              <span className="text-[10px] text-muted-2">
                {s.sampleSize === null ? "sample N/A" : `${s.sampleSize} AB`}
                {s.smallSample && <span className="ml-1 rounded bg-[var(--warning)]/15 px-1 text-[var(--warning)]">SAMPLE LIMITED</span>}
              </span>
            </div>
            <div className="flex flex-wrap gap-x-4 gap-y-1">
              {s.metrics.map((m) => (
                <span key={m.key} className="text-[11px] text-muted">
                  {m.label} <span className="font-semibold tabular-nums text-foreground">{formatMetric(m)}</span>
                </span>
              ))}
            </div>
          </div>
        ))}
      </div>
    </SectionCard>
  );
}

/* ------------------------------ pitch type -------------------------------- */

export function PitchTypeTable({ pitchTypes }: { pitchTypes: VmPitchType[] }) {
  if (pitchTypes.length === 0) return null;
  return (
    <SectionCard title="By Pitch Type" right={<span className="text-[10px] text-muted-2">Statcast arsenal</span>}>
      <div className="overflow-x-auto">
        <table className="w-full min-w-[520px] text-xs">
          <thead>
            <tr className="text-left text-[10px] uppercase tracking-wider text-muted-2">
              <th className="pb-1.5 font-semibold">Pitch</th>
              <th className="pb-1.5 text-right font-semibold">Usage</th>
              <th className="pb-1.5 text-right font-semibold">Whiff%</th>
              <th className="pb-1.5 text-right font-semibold">BA</th>
              <th className="pb-1.5 text-right font-semibold">SLG</th>
              <th className="pb-1.5 text-right font-semibold">xwOBA</th>
              <th className="pb-1.5 text-right font-semibold">Matchup</th>
            </tr>
          </thead>
          <tbody className="tabular-nums">
            {pitchTypes.map((p) => (
              <tr key={p.pitchType} className="border-t border-border/60">
                <td className="py-1.5 font-medium">{p.pitchName || p.pitchType}</td>
                <td className="py-1.5 text-right">{p.usage === null ? "—" : `${p.usage.toFixed(0)}%`}</td>
                <td className="py-1.5 text-right">{p.whiffPct === null ? "—" : `${p.whiffPct.toFixed(0)}%`}</td>
                <td className="py-1.5 text-right">{p.baAllowed === null ? "—" : p.baAllowed.toFixed(3)}</td>
                <td className="py-1.5 text-right">{p.slgAllowed === null ? "—" : p.slgAllowed.toFixed(3)}</td>
                <td className="py-1.5 text-right">{p.xwobaAllowed === null ? "—" : p.xwobaAllowed.toFixed(3)}</td>
                <td className="py-1.5 text-right"><PitchEdge edge={p.edge} /></td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      <p className="mt-2 text-[10px] text-muted-2">Matchup indicator derived from pitch whiff% and xwOBA-allowed vs league norms. Insufficient data → N/A.</p>
    </SectionCard>
  );
}

function PitchEdge({ edge }: { edge: VmPitchType["edge"] }) {
  if (edge === null) return <span className="text-muted-2">N/A</span>;
  const map = {
    pitcher: { t: "Pitcher edge", c: "text-brand-500" },
    batter: { t: "Batter edge", c: "text-[var(--positive)]" },
    neutral: { t: "Neutral", c: "text-muted" },
  } as const;
  return <span className={cn("font-medium", map[edge].c)}>{map[edge].t}</span>;
}

/* ------------------------------ section card ------------------------------ */

export function SectionCard({ title, icon, right, children }: { title: string; icon?: React.ReactNode; right?: React.ReactNode; children: React.ReactNode }) {
  return (
    <section className="panel p-4">
      <div className="mb-3 flex items-center gap-2">
        {icon}
        <h3 className="text-[13px] font-bold uppercase tracking-wider">{title}</h3>
        {right && <div className="ml-auto">{right}</div>}
      </div>
      {children}
    </section>
  );
}
