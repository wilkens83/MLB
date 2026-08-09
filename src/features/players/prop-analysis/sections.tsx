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
            hint={calSel === null ? "no fit" : sci.calibrationVersion}
          />
          <Stat label={`Baseline P(${sideLabel})`} value={sci.baselineProbability === null ? "—" : pctStr(sci.baselineProbability)} />
          <Stat
            label="Model Advantage"
            value={sci.modelAdvantagePp === null ? "N/A" : `${sci.modelAdvantagePp > 0 ? "+" : ""}${sci.modelAdvantagePp} pp`}
            tone={sci.modelAdvantagePp === null ? "muted" : sci.modelAdvantagePp > 0 ? "good" : "bad"}
            hint={sci.modelAdvantagePp === null ? "needs calibration" : undefined}
          />
        </div>
        <div>
          <Stat label="Projection" value={`${sci.projection.mean}`} />
          <Stat label="Median" value={`${sci.projection.median}`} />
          <Stat label={sci.projection.bandLabel} value={`${sci.projection.band[0]}–${sci.projection.band[1]}`} />
          <Stat label="Uncertainty (±95%)" value={sci.uncertaintyHalfWidth95 === null ? "—" : `±${(sci.uncertaintyHalfWidth95 * 100).toFixed(1)}pp`} />
        </div>
      </div>
      <div className="mt-3 flex flex-wrap gap-2">
        <Chip label="Data Quality" value={`${sci.dataQuality}/100`} />
        <Chip label="Fragility" value={sci.fragilityLevel ?? "—"} tone={sci.fragilityLevel === "LOW" ? "good" : sci.fragilityLevel === "HIGH" || sci.fragilityLevel === "EXTREME" ? "bad" : "neutral"} />
        <Chip label="Training" value={sci.trainingSupport} />
        <Chip label="Model" value={sci.modelLifecycle} />
      </div>
      <p className="mt-2 flex items-start gap-1 text-[10px] leading-relaxed text-muted-2">
        <Info className="mt-px h-3 w-3 shrink-0" />
        Data Quality is input completeness, not a probability. Calibrated probability is shown only when a fit exists; raw is never relabeled as calibrated.
      </p>
    </SectionCard>
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

export function DecisionBlock({ decision }: { decision: VmDecision }) {
  const tone = DECISION_TONE[decision.status];
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
      {decision.reasons.length > 0 && (
        <div className="mt-3">
          <div className="text-[11px] font-semibold uppercase tracking-wider text-muted">Reasons</div>
          <ul className="mt-1 space-y-0.5">
            {decision.reasons.map((r, i) => (
              <li key={i} className="flex items-start gap-1.5 text-xs text-text-secondary">
                <span className="mt-1 h-1 w-1 shrink-0 rounded-full bg-muted" />{r}
              </li>
            ))}
          </ul>
        </div>
      )}
      {decision.risks.length > 0 && (
        <div className="mt-3">
          <div className="flex items-center gap-1 text-[11px] font-semibold uppercase tracking-wider text-[var(--warning)]">
            <CircleAlert className="h-3 w-3" /> Risks
          </div>
          <ul className="mt-1 space-y-0.5">
            {decision.risks.map((r, i) => (
              <li key={i} className="flex items-start gap-1.5 text-xs text-muted">
                <span className="mt-1 h-1 w-1 shrink-0 rounded-full bg-[var(--warning)]" />{r}
              </li>
            ))}
          </ul>
        </div>
      )}
    </SectionCard>
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

export function MatchupPercentiles({ matchup, playerLabel, opponentLabel }: { matchup: VmMatchup; playerLabel: string; opponentLabel: string }) {
  if (!matchup.available) {
    return (
      <SectionCard title="Percentile Matchup">
        <p className="text-sm text-muted">{matchup.note ?? "Matchup profile unavailable."}</p>
      </SectionCard>
    );
  }
  return (
    <SectionCard title="Percentile Matchup" right={<span className="text-[10px] text-muted-2">Pitcher edge ← → Batter edge</span>}>
      <div className="mb-2 flex items-center justify-between text-[11px] font-semibold uppercase tracking-wider text-muted">
        <span>{playerLabel}</span>
        <span>{opponentLabel}</span>
      </div>
      <div className="space-y-1">
        {matchup.rows.map((r) => (
          <div key={r.metric} className="grid grid-cols-[1fr_auto_1fr] items-center gap-2 text-xs">
            <span className="text-right tabular-nums">{r.playerValue === null ? "—" : fmtVal(r.playerValue)}</span>
            <span className="w-16 text-center text-[10px] font-medium uppercase tracking-wider text-muted-2">{r.label}</span>
            <span className="tabular-nums">{r.opponentValue === null ? "—" : fmtVal(r.opponentValue)}</span>
          </div>
        ))}
      </div>
      {matchup.note && <p className="mt-2 flex items-start gap-1 text-[10px] leading-relaxed text-muted-2"><Info className="mt-px h-3 w-3 shrink-0" />{matchup.note}</p>}
    </SectionCard>
  );
}

function fmtVal(v: number): string {
  if (v > 0 && v < 1) return v.toFixed(3);
  return v.toFixed(v >= 100 ? 0 : 1);
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
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </SectionCard>
  );
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
