"use client";

import { useQuery } from "@tanstack/react-query";
import { Activity, Database, ShieldCheck, Clock } from "lucide-react";
import { Card } from "@/components/ui/card";
import { StatPill } from "@/components/ui/primitives";
import type { ProviderHealth } from "@/lib/providers/types";

interface HealthPayload {
  generatedAt: number;
  cache: { total: number; live: number; stale: number };
  validationFailures: number;
  providers: ProviderHealth[];
}

export default function HealthPage() {
  const { data, isLoading } = useQuery({
    queryKey: ["health"],
    queryFn: async () => (await fetch("/api/health")).json() as Promise<HealthPayload>,
    refetchInterval: 10000,
  });

  return (
    <div className="space-y-6">
      <div className="glass rounded-2xl p-6">
        <h1 className="flex items-center gap-2 text-2xl font-black tracking-tight">
          <Activity className="h-6 w-6 text-brand-500" /> Data Health
        </h1>
        <p className="mt-1 text-sm text-muted">
          Live provider status, cache utilization, and validation integrity. Auto-refreshes every 10s.
        </p>
      </div>

      <div className="grid gap-4 sm:grid-cols-4">
        <StatPill label="Cache entries" value={data?.cache.total ?? "—"} tone="brand" />
        <StatPill label="Live entries" value={data?.cache.live ?? "—"} hint="unexpired" />
        <StatPill label="Stale entries" value={data?.cache.stale ?? "—"} />
        <StatPill
          label="Validation failures"
          value={data?.validationFailures ?? "—"}
          tone={data && data.validationFailures > 0 ? "negative" : "default"}
          hint="malformed upstream payloads"
        />
      </div>

      <Card className="p-5">
        <h2 className="mb-4 flex items-center gap-2 font-semibold">
          <Database className="h-4 w-4 text-brand-500" /> Providers
        </h2>
        {isLoading && <p className="text-sm text-muted">Loading…</p>}
        {data && data.providers.length === 0 && (
          <p className="text-sm text-muted">No provider requests recorded yet this session.</p>
        )}
        <div className="space-y-3">
          {data?.providers.map((p) => (
            <div key={p.name} className="flex flex-wrap items-center gap-x-6 gap-y-2 rounded-xl border border-border bg-surface-2/40 p-4">
              <span className="flex items-center gap-2 font-medium">
                <ShieldCheck className={p.failures === 0 ? "h-4 w-4 text-[var(--positive)]" : "h-4 w-4 text-[var(--warning)]"} />
                {p.name}
              </span>
              <span className="text-sm text-muted">{p.requests} requests</span>
              <span className="text-sm text-muted">
                {p.failures} failures ({p.requests ? ((p.failures / p.requests) * 100).toFixed(0) : 0}%)
              </span>
              <span className="text-sm text-muted">avg {Math.round(p.avgResponseMs)}ms</span>
              <span className="ml-auto flex items-center gap-1 text-xs text-muted-2">
                <Clock className="h-3 w-3" />
                {p.lastSuccessAt ? `ok ${timeAgo(p.lastSuccessAt)}` : "no success yet"}
              </span>
            </div>
          ))}
        </div>
      </Card>
    </div>
  );
}

function timeAgo(ts: number) {
  const s = Math.max(0, Math.round((Date.now() - ts) / 1000));
  if (s < 60) return `${s}s ago`;
  const m = Math.round(s / 60);
  return `${m}m ago`;
}
