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
  const { dataMode, freeDataset } = status;
  const cov = freeDataset.coverage;

  return (
    <div className="space-y-6">
      <header className="glass rounded-2xl p-6">
        <div className="flex flex-wrap items-center gap-3">
          <h1 className="flex items-center gap-2 text-2xl font-black tracking-tight">
            <Activity className="h-6 w-6 text-brand-500" /> Data Health
          </h1>
          <span className="rounded-full bg-brand-500/12 px-3 py-1 text-xs font-semibold text-brand-500">
            Data Mode: {dataMode.label}
          </span>
        </div>
        <p className="mt-1 text-sm text-muted">
          Every Tennis data path — free historical, manual entry, demo fixtures, and the
          (optional) paid live providers — with its real status. LIVE is shown only when a
          credentialed provider was actually verified live; free/historical data is never
          mislabeled as live.
        </p>
      </header>

      <div className="grid gap-4 sm:grid-cols-4">
        <StatPill label="Historical analytics" value={status.historicalConfigured ? "Available" : "None"} tone={status.historicalConfigured ? "positive" : "default"} />
        <StatPill label="Manual analysis" value="Available" tone="positive" />
        <StatPill label="Demo interface" value="Available" tone="positive" />
        <StatPill label="Automated live feed" value={status.liveConfigured ? "Connected" : "Unavailable"} tone={status.liveConfigured ? "positive" : "default"} />
      </div>

      <Card className="p-5">
        <h2 className="mb-3 flex items-center gap-2 font-semibold">
          <Database className="h-4 w-4 text-brand-500" /> Free dataset — provenance &amp; coverage
        </h2>
        <div className="grid gap-x-6 gap-y-2 text-sm sm:grid-cols-2">
          <Row k="Source" v={freeDataset.manifest.source} />
          <Row k="Dataset version" v={freeDataset.manifest.datasetVersion} />
          <Row k="Coverage" v={`${freeDataset.manifest.coverageStart} → ${freeDataset.manifest.coverageEnd} (${cov.yearsCovered.join(", ")})`} />
          <Row k="Usage" v={`${freeDataset.manifest.licenseUse}`} />
          <Row k="ATP players / matches" v={`${cov.atpPlayers} / ${cov.atpMatches}`} />
          <Row k="WTA players / matches" v={`${cov.wtaPlayers} / ${cov.wtaMatches}`} />
          <Row k="Ranking observations" v={`${cov.rankingObservations}`} />
          <Row k="Detailed serve stats" v={`${cov.matchesWithServeStats} with / ${cov.matchesWithoutServeStats} without`} />
        </div>
        <p className="mt-3 flex items-start gap-2 text-xs text-muted">
          <ShieldCheck className="mt-0.5 h-3.5 w-3.5 shrink-0 text-[var(--warning)]" />
          License: {freeDataset.manifest.license}. This is research / non-commercial data — it
          cannot silently become a commercial production feed.
        </p>
      </Card>

      {!status.liveConfigured && (
        <div className="glass flex items-start gap-3 rounded-2xl border border-border p-5">
          <PlugZap className="mt-0.5 h-5 w-5 shrink-0 text-brand-500" />
          <div className="text-sm">
            <p className="font-semibold">Historical analytics available; automated live feed unavailable.</p>
            <p className="mt-0.5 text-muted">
              No paid provider key is set, so there is no automated live schedule. The Tennis
              section is fully usable via free historical data and manual matchups. Add a
              Sportradar / SportsDataIO / API-Tennis key (server-side only) to enable a verified
              live feed — free/historical data is never substituted for live.
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
                <p className="mt-1 text-[11px] uppercase tracking-wide text-muted-2">mode: {p.mode}</p>
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

function Row({ k, v }: { k: string; v: string }) {
  return (
    <div className="flex justify-between gap-3 border-b border-border/40 py-1">
      <span className="text-muted-2">{k}</span>
      <span className="text-right font-medium">{v}</span>
    </div>
  );
}
