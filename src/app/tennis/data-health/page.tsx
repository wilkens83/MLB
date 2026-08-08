import { Activity, Database, ShieldCheck, PlugZap } from "lucide-react";
import { Card } from "@/components/ui/card";
import { StatPill } from "@/components/ui/primitives";
import { getTennisDataStatus } from "@/lib/tennis/status";

export const dynamic = "force-dynamic";
export const revalidate = 0;

const STATUS_TONE: Record<string, { label: string; cls: string }> = {
  ready: { label: "Ready", cls: "text-[var(--positive)]" },
  configured_unverified: { label: "Configured — unverified", cls: "text-[var(--warning)]" },
  authenticating: { label: "Authenticating", cls: "text-muted-2" },
  degraded: { label: "Degraded", cls: "text-[var(--warning)]" },
  rate_limited: { label: "Rate limited", cls: "text-[var(--warning)]" },
  entitlement_missing: { label: "Entitlement missing", cls: "text-[var(--warning)]" },
  unconfigured: { label: "Unconfigured", cls: "text-muted-2" },
  disabled: { label: "Disabled", cls: "text-muted-2" },
  error: { label: "Error", cls: "text-[var(--negative)]" },
  fixture: { label: "Fixture (test-only)", cls: "text-[var(--warning)]" },
};

const CAP_MARK: Record<string, string> = {
  verified: "✓", supported: "•", entitlement_missing: "⨯", unsupported: "–",
};

export default function TennisDataHealthPage() {
  const status = getTennisDataStatus();
  const readyCount = status.providers.filter((p) => p.status === "ready").length;

  return (
    <div className="space-y-6">
      <header className="glass rounded-2xl p-6">
        <h1 className="flex items-center gap-2 text-2xl font-black tracking-tight">
          <Activity className="h-6 w-6 text-brand-500" /> Data Health
        </h1>
        <p className="mt-1 text-sm text-muted">
          Tennis provider readiness. Live providers are inert by design until a server-side API
          key is configured — this page reports their real status, never a fabricated &ldquo;ok&rdquo;.
        </p>
      </header>

      <div className="grid gap-4 sm:grid-cols-3">
        <StatPill label="Live providers ready" value={readyCount} tone={readyCount > 0 ? "positive" : "default"} />
        <StatPill
          label="Live data"
          value={status.liveConfigured ? "Connected" : "Not configured"}
          tone={status.liveConfigured ? "positive" : "default"}
        />
        <StatPill
          label="Historical corpus"
          value={status.historicalConfigured ? "Loaded" : "None"}
          hint="backtesting priors"
        />
      </div>

      {!status.liveConfigured && (
        <div className="glass flex items-start gap-3 rounded-2xl border border-[var(--warning)]/25 p-5">
          <PlugZap className="mt-0.5 h-5 w-5 shrink-0 text-[var(--warning)]" />
          <div className="text-sm">
            <p className="font-semibold">No live provider configured</p>
            <p className="mt-0.5 text-muted">
              Set a provider API key (server-side only) to activate live schedules, results and
              rankings. Until then the tennis surface shows honest empty states and never
              substitutes fixtures for production data.
            </p>
          </div>
        </div>
      )}

      <Card className="p-5">
        <h2 className="mb-4 flex items-center gap-2 font-semibold">
          <Database className="h-4 w-4 text-brand-500" /> Providers
        </h2>
        <div className="space-y-3">
          {status.providers.map((p) => {
            const tone = STATUS_TONE[p.status] ?? STATUS_TONE.unconfigured;
            return (
              <div key={p.name} className="rounded-xl border border-border bg-surface-2/40 p-4">
                <div className="flex flex-wrap items-center gap-x-4 gap-y-1">
                  <span className="flex items-center gap-2 font-medium">
                    <ShieldCheck className={p.status === "ready" ? "h-4 w-4 text-[var(--positive)]" : "h-4 w-4 text-muted-2"} />
                    {p.name}
                  </span>
                  <span className={`text-sm font-semibold ${tone.cls}`}>{tone.label}</span>
                  <span className="ml-auto flex flex-wrap gap-1">
                    {p.capabilities.map((c) => {
                      const cs = p.capabilityStatus?.[c];
                      const mark = cs ? CAP_MARK[cs] : "";
                      return (
                        <span
                          key={c}
                          title={cs ?? "declared"}
                          className="rounded-full border border-border px-2 py-0.5 text-[10px] uppercase tracking-wide text-muted-2"
                        >
                          {mark && <span className="mr-1">{mark}</span>}{c}
                        </span>
                      );
                    })}
                  </span>
                </div>
                {p.detail && <p className="mt-2 text-xs text-muted">{p.detail}</p>}
                {p.lastVerifiedAt && (
                  <p className="mt-1 text-[11px] text-muted-2">
                    Last verified {new Date(p.lastVerifiedAt).toISOString().replace("T", " ").slice(0, 19)} UTC
                    {p.avgResponseMs ? ` · ~${Math.round(p.avgResponseMs)}ms` : ""}
                  </p>
                )}
              </div>
            );
          })}
        </div>
      </Card>
    </div>
  );
}
