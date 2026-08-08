import type { ReactNode } from "react";
import { Activity, Database, ShieldCheck, Clock, GitBranch, Gauge, AlertTriangle, FlaskConical } from "lucide-react";
import { Card } from "@/components/ui/card";
import { getScientificHealth, type ReadinessStatus } from "@/lib/supabase/scientific-health";

export const dynamic = "force-dynamic";
export const revalidate = 0;

// Every value on this page is SERVER-derived from trusted Supabase scientific
// records + provider health — no client supplies a status.
export default async function HealthPage() {
  const r = await getScientificHealth();

  return (
    <div className="space-y-6">
      <header className="glass rounded-2xl p-6">
        <h1 className="flex items-center gap-2 text-2xl font-black tracking-tight">
          <FlaskConical className="h-6 w-6 text-brand-500" /> Scientific Health &amp; Model Performance
        </h1>
        <p className="mt-1 text-sm text-muted">
          Trusted server metrics only. Data sources, scientific persistence, point-in-time integrity,
          model registry, calibration, drift, circuit breakers, and forward performance. All numbers come
          from Supabase records — thin samples show <b>INSUFFICIENT DATA</b>, never zero-error perfection.
        </p>
        <p className="mt-1 text-[11px] text-muted-2">Generated {r.generatedAt}</p>
      </header>

      <Card className="p-5">
        <SectionTitle icon={ShieldCheck}>Scientific Readiness</SectionTitle>
        <div className="grid gap-2 sm:grid-cols-2 lg:grid-cols-4">
          <Readiness label="Persistence" status={r.readiness.persistence} />
          <Readiness label="Point-in-time" status={r.readiness.pointInTime} />
          <Readiness label="Prospective calibration" status={r.readiness.prospectiveCalibration} />
          <Readiness label="Predictive profitability" status={r.readiness.predictiveProfitability} />
        </div>
        {r.readiness.blockers.length > 0 && (
          <div className="mt-3 rounded-xl border border-[var(--warning)]/25 bg-[var(--warning)]/8 p-3">
            <p className="mb-1 text-xs font-semibold uppercase tracking-wide text-[var(--warning)]">Current blockers</p>
            <ul className="list-disc pl-5 text-sm text-muted">
              {r.readiness.blockers.map((b, i) => <li key={i}>{b}</li>)}
            </ul>
          </div>
        )}
      </Card>

      <Card className="p-5">
        <SectionTitle icon={Activity}>System Health</SectionTitle>
        <div className="mb-3 flex flex-wrap items-center gap-2">
          <span className="text-sm">Supabase:</span>
          <Pill tone={r.system.supabase === "CONNECTED" ? "pos" : r.system.supabase === "DEGRADED" ? "warn" : "muted"}>{r.system.supabase}</Pill>
          <span className="text-xs text-muted-2">
            configured {String(r.system.configured)} · service-role {String(r.system.serviceRole)}
            {r.system.error ? ` · ${r.system.error}` : ""}
          </span>
        </div>
        <div className="grid gap-2 sm:grid-cols-2 lg:grid-cols-3">
          {r.system.providers.length === 0 && <span className="text-sm text-muted-2">No provider activity recorded yet.</span>}
          {r.system.providers.map((p) => (
            <div key={p.name} className="flex items-center justify-between rounded-xl border border-border bg-surface-2/40 px-3 py-2 text-sm">
              <span className="flex items-center gap-2 font-medium">
                <ShieldCheck className={p.failures === 0 ? "h-3.5 w-3.5 text-[var(--positive)]" : "h-3.5 w-3.5 text-[var(--warning)]"} />
                {p.name}
              </span>
              <span className="text-muted-2">
                {p.requests} req · {p.failures} fail{p.avgResponseMs ? ` · ~${Math.round(p.avgResponseMs)}ms` : ""}
              </span>
            </div>
          ))}
        </div>
      </Card>

      <Card className="p-5">
        <SectionTitle icon={Database}>Scientific Persistence</SectionTitle>
        <Table head={["Table", "Count", "Latest"]}>
          {r.persistence.map((t) => (
            <tr key={t.table} className="border-t border-border/40">
              <Td>{t.table}</Td>
              <Td mono>{t.count}</Td>
              <Td muted>{t.latestAt ? t.latestAt.replace("T", " ").slice(0, 19) : <Insufficient />}</Td>
            </tr>
          ))}
        </Table>
      </Card>

      <Card className="p-5">
        <SectionTitle icon={Clock}>Point-in-Time Integrity</SectionTitle>
        <div className="flex flex-wrap items-center gap-4 text-sm">
          <Metric label="Temporal violations" value={r.pointInTime.temporalViolations} bad={r.pointInTime.temporalViolations > 0} />
          <Metric label="Late observations" value={r.pointInTime.lateObservations} bad={r.pointInTime.lateObservations > 0} />
          <Metric label="Future-data references" value={r.pointInTime.invalidFutureDataReferences} bad={r.pointInTime.invalidFutureDataReferences > 0} />
          <div className="flex items-center gap-2"><span className="text-muted-2">Status</span><Readiness label="" status={r.pointInTime.status} compact /></div>
        </div>
      </Card>

      <Card className="p-5">
        <SectionTitle icon={GitBranch}>Model Registry</SectionTitle>
        {r.modelRegistry.length === 0 ? <Insufficient block /> : (
          <Table head={["Market", "Model", "State", "Prospective n", "Brier", "Log loss", "Calib err", "Computed"]}>
            {r.modelRegistry.map((m) => (
              <tr key={m.market + m.modelVersion} className="border-t border-border/40">
                <Td>{m.market}</Td>
                <Td mono>{m.modelVersion}</Td>
                <Td><Pill tone={stateTone(m.state)}>{m.state}</Pill></Td>
                <Td mono>{m.prospectiveSample}</Td>
                <Td mono>{fmt(m.brier)}</Td>
                <Td mono>{fmt(m.logLoss)}</Td>
                <Td mono>{fmt(m.calibrationError)}</Td>
                <Td muted>{m.lastComputedAt ? m.lastComputedAt.slice(0, 10) : <Insufficient />}</Td>
              </tr>
            ))}
          </Table>
        )}
      </Card>

      <Card className="p-5">
        <SectionTitle icon={Gauge}>Calibration (predicted vs observed)</SectionTitle>
        {r.calibration.status === "INSUFFICIENT_DATA" ? (
          <Insufficient block note={`${r.calibration.sampleCount}/100 graded predictions`} />
        ) : (
          <Table head={["Predicted bucket", "Predicted", "Observed", "n"]}>
            {r.calibration.buckets.map((b) => (
              <tr key={b.bucket} className="border-t border-border/40">
                <Td>{b.bucket}</Td>
                <Td mono>{fmt(b.predicted)}</Td>
                <Td mono>{fmt(b.observed)}</Td>
                <Td mono>{b.n}</Td>
              </tr>
            ))}
          </Table>
        )}
      </Card>

      <Card className="p-5">
        <SectionTitle icon={Activity}>Feature Drift</SectionTitle>
        {r.drift.length === 0 ? <Insufficient block /> : (
          <Table head={["Feature", "Metric", "Value", "Status", "Window"]}>
            {r.drift.map((d, i) => (
              <tr key={i} className="border-t border-border/40">
                <Td>{d.feature}</Td>
                <Td mono>{d.metric}</Td>
                <Td mono>{fmt(d.value)}</Td>
                <Td><Pill tone={d.breach ? "warn" : "muted"}>{d.status}</Pill></Td>
                <Td muted>{d.window}</Td>
              </tr>
            ))}
          </Table>
        )}
      </Card>

      <Card className="p-5">
        <SectionTitle icon={AlertTriangle}>Circuit Breakers — {r.circuitBreakers.activeCount} active</SectionTitle>
        {r.circuitBreakers.events.length === 0 ? (
          <p className="text-sm text-muted-2">No active circuit breakers.</p>
        ) : (
          <Table head={["Market", "Breaker", "Reason", "Severity", "Triggered"]}>
            {r.circuitBreakers.events.map((b, i) => (
              <tr key={i} className="border-t border-border/40">
                <Td>{b.market ?? "—"}</Td>
                <Td mono>{b.breakerType}</Td>
                <Td muted>{b.reason}</Td>
                <Td><Pill tone="warn">{b.severity}</Pill></Td>
                <Td muted>{b.triggeredAt.replace("T", " ").slice(0, 19)}</Td>
              </tr>
            ))}
          </Table>
        )}
      </Card>

      <Card className="p-5">
        <SectionTitle icon={Clock}>Ungraded Predictions</SectionTitle>
        <p className="text-sm text-muted">
          <b className="text-foreground tabular-nums">{r.ungradedCount}</b> eligible prediction(s) waiting for an official result.
        </p>
      </Card>

      <Card className="p-5">
        <SectionTitle icon={Gauge}>Model Performance</SectionTitle>
        <p className="mb-2 text-xs text-muted-2">Realized profitability is only claimed when the sample requirement is met — otherwise INSUFFICIENT DATA.</p>
        <Table head={["Window", "n", "Qualified", "Brier", "Log loss", "ECE", "MAE", "RMSE", "Exp. return", "Realized", "Drawdown"]}>
          {r.performance.map((p) => (
            <tr key={p.window} className="border-t border-border/40">
              <Td>{p.window}</Td>
              {p.status === "INSUFFICIENT_DATA" ? (
                <td colSpan={10} className="px-2 py-1"><Insufficient note={`${p.sampleCount} graded`} /></td>
              ) : (
                <>
                  <Td mono>{p.sampleCount}</Td>
                  <Td mono>{p.qualifiedCount ?? "—"}</Td>
                  <Td mono>{fmt(p.brier)}</Td>
                  <Td mono>{fmt(p.logLoss)}</Td>
                  <Td mono>{fmt(p.calibrationError)}</Td>
                  <Td mono>{fmt(p.mae)}</Td>
                  <Td mono>{fmt(p.rmse)}</Td>
                  <Td mono>{fmt(p.expectedReturn)}</Td>
                  <Td mono>{fmt(p.realizedReturn)}</Td>
                  <Td mono>{fmt(p.drawdown)}</Td>
                </>
              )}
            </tr>
          ))}
        </Table>
      </Card>
    </div>
  );
}

/* ------------------------------- UI helpers ------------------------------- */

function SectionTitle({ icon: Icon, children }: { icon: typeof Activity; children: ReactNode }) {
  return <h2 className="mb-3 flex items-center gap-2 font-semibold"><Icon className="h-4 w-4 text-brand-500" /> {children}</h2>;
}

function fmt(n: number | null): string {
  return n === null || n === undefined ? "—" : (Math.abs(n) < 1 ? n.toFixed(3) : n.toFixed(2));
}

function Insufficient({ block = false, note }: { block?: boolean; note?: string } = {}) {
  const el = (
    <span className="inline-flex items-center gap-1 rounded-full border border-border px-2 py-0.5 text-[10px] font-medium uppercase tracking-wide text-muted-2">
      Insufficient data{note ? ` · ${note}` : ""}
    </span>
  );
  return block ? <div className="py-1">{el}</div> : el;
}

const READINESS_TONE: Record<ReadinessStatus, "pos" | "warn" | "muted" | "neg"> = {
  PASS: "pos", IN_PROGRESS: "warn", FAIL: "neg", NOT_DEMONSTRATED: "warn", UNAVAILABLE: "muted",
};
function Readiness({ label, status, compact }: { label: string; status: ReadinessStatus; compact?: boolean }) {
  const text = status.replace(/_/g, " ");
  if (compact) return <Pill tone={READINESS_TONE[status]}>{text}</Pill>;
  return (
    <div className="rounded-xl border border-border bg-surface-2/40 p-3">
      <p className="text-xs text-muted-2">{label}</p>
      <div className="mt-1"><Pill tone={READINESS_TONE[status]}>{text}</Pill></div>
    </div>
  );
}

function stateTone(state: string): "pos" | "warn" | "muted" | "neg" {
  if (state === "PRODUCTION" || state === "VALIDATED") return "pos";
  if (state === "SUSPENDED" || state === "RETIRED") return "neg";
  if (state === "PROVISIONAL") return "warn";
  return "muted";
}

function Pill({ tone, children }: { tone: "pos" | "warn" | "muted" | "neg"; children: ReactNode }) {
  const cls = tone === "pos" ? "text-[var(--positive)] border-[var(--positive)]/30 bg-[var(--positive)]/10"
    : tone === "warn" ? "text-[var(--warning)] border-[var(--warning)]/30 bg-[var(--warning)]/10"
    : tone === "neg" ? "text-[var(--negative)] border-[var(--negative)]/30 bg-[var(--negative)]/10"
    : "text-muted-2 border-border bg-surface-2";
  return <span className={`inline-flex rounded-full border px-2 py-0.5 text-[11px] font-semibold uppercase tracking-wide ${cls}`}>{children}</span>;
}

function Metric({ label, value, bad }: { label: string; value: number; bad?: boolean }) {
  return (
    <div className="rounded-xl border border-border bg-surface-2/40 px-3 py-2">
      <p className="text-xs text-muted-2">{label}</p>
      <p className={`text-lg font-bold tabular-nums ${bad ? "text-[var(--negative)]" : ""}`}>{value}</p>
    </div>
  );
}

function Table({ head, children }: { head: string[]; children: ReactNode }) {
  return (
    <div className="overflow-x-auto">
      <table className="w-full text-left text-sm">
        <thead>
          <tr className="text-[11px] uppercase tracking-wide text-muted-2">
            {head.map((h) => <th key={h} className="px-2 py-1 font-medium">{h}</th>)}
          </tr>
        </thead>
        <tbody>{children}</tbody>
      </table>
    </div>
  );
}

function Td({ children, mono, muted }: { children: ReactNode; mono?: boolean; muted?: boolean }) {
  return <td className={`px-2 py-1 ${mono ? "tabular-nums" : ""} ${muted ? "text-muted-2" : ""}`}>{children}</td>;
}
