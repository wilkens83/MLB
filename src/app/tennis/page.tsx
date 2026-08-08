import Link from "next/link";
import { Activity, Cpu, Dices, TrendingUp, ArrowRight, Sparkles, Database, PenLine, Play, CheckCircle2, XCircle } from "lucide-react";
import { Button, Badge } from "@/components/ui/primitives";
import { getTennisDataStatus } from "@/lib/tennis/status";
import { TENNIS_MARKETS } from "@/lib/tennis/domain/markets";

export const dynamic = "force-dynamic";
export const revalidate = 0;

export default function TennisHomePage() {
  const status = getTennisDataStatus();
  const { dataMode, freeDataset } = status;

  return (
    <div className="space-y-10">
      <Hero mode={dataMode.label} />
      <FeatureStrip />
      <DataModeSection status={status} />
      <section>
        <div className="mb-4 flex items-end justify-between">
          <div>
            <h2 className="flex items-center gap-2 text-xl font-bold">
              <Activity className="h-5 w-5 text-brand-500" /> Explore
            </h2>
            <p className="text-sm text-muted">
              {dataMode.liveVerified
                ? "Live provider connected — real slate available."
                : "No paid live feed — analyze real free historical data, enter a manual matchup, or explore the demo."}
            </p>
          </div>
        </div>
        <div className="grid gap-4 sm:grid-cols-3">
          <ActionCard href="/tennis/matches" icon={Database} title="Explore historical slate"
            body={`${freeDataset.coverage.atpMatches + freeDataset.coverage.wtaMatches} real ATP/WTA matches, ${freeDataset.coverage.yearsCovered.join("–")}.`} />
          <ActionCard href="/tennis/players" icon={PenLine} title="Research a player"
            body={`${freeDataset.coverage.atpPlayers + freeDataset.coverage.wtaPlayers} players with surface splits, Elo, serve/return form.`} />
          <ActionCard href="/tennis/data-health" icon={Play} title="Data mode & provenance"
            body={`Active mode: ${dataMode.label}. Source + license + coverage.`} />
        </div>
      </section>
    </div>
  );
}

function DataModeSection({ status }: { status: ReturnType<typeof getTennisDataStatus> }) {
  const rows: { label: string; ok: boolean }[] = [
    { label: "Historical analytics", ok: status.historicalConfigured },
    { label: "Manual analysis", ok: true },
    { label: "Demo interface", ok: status.providers.some((p) => p.name === "demo-fixture" && p.status === "fixture") },
    { label: "Automated live feed", ok: status.liveConfigured },
  ];
  return (
    <section className="glass rounded-2xl p-6">
      <div className="mb-4 flex flex-wrap items-center gap-3">
        <h2 className="flex items-center gap-2 text-xl font-bold">
          <Database className="h-5 w-5 text-brand-500" /> Tennis Data Mode
        </h2>
        <Badge variant="brand">{status.dataMode.label}</Badge>
        {!status.dataMode.liveVerified && (
          <span className="text-xs text-muted-2">Free / research data — not a live feed.</span>
        )}
      </div>
      <div className="grid gap-2 sm:grid-cols-2 lg:grid-cols-4">
        {rows.map((r) => (
          <div key={r.label} className="flex items-center gap-2 rounded-xl border border-border bg-surface-2/40 px-3 py-2 text-sm">
            {r.ok
              ? <CheckCircle2 className="h-4 w-4 text-[var(--positive)]" />
              : <XCircle className="h-4 w-4 text-muted-2" />}
            <span className={r.ok ? "" : "text-muted-2"}>{r.label}</span>
            <span className="ml-auto text-[11px] uppercase tracking-wide text-muted-2">{r.ok ? "available" : "unavailable"}</span>
          </div>
        ))}
      </div>
      <p className="mt-3 text-xs text-muted">
        Source: {status.freeDataset.manifest.source} · {status.freeDataset.manifest.datasetVersion} · Usage:{" "}
        {status.freeDataset.manifest.licenseUse} ({status.freeDataset.manifest.license}).
      </p>
    </section>
  );
}

function ActionCard({ href, icon: Icon, title, body }: { href: string; icon: typeof Database; title: string; body: string }) {
  return (
    <Link href={href} className="glass group rounded-2xl p-5 transition hover:border-brand-500/40">
      <div className="mb-3 grid h-10 w-10 place-items-center rounded-xl bg-brand-500/12 text-brand-500">
        <Icon className="h-5 w-5" />
      </div>
      <h3 className="flex items-center gap-1 font-semibold">{title}<ArrowRight className="h-4 w-4 opacity-0 transition group-hover:opacity-100" /></h3>
      <p className="mt-1 text-sm text-muted">{body}</p>
    </Link>
  );
}

function Hero({ mode }: { mode: string }) {
  return (
    <section className="glass relative overflow-hidden rounded-2xl p-8 sm:p-12">
      <div className="absolute -right-20 -top-24 h-72 w-72 rounded-full bg-brand-500/20 blur-3xl" />
      <div className="relative max-w-2xl">
        <Badge variant="brand" className="mb-4">
          <Sparkles className="h-3 w-3" /> {TENNIS_MARKETS.length} tennis markets · {mode.toLowerCase()} data
        </Badge>
        <h1 className="text-balance text-4xl font-black leading-[1.05] tracking-tight sm:text-5xl">
          Find the <span className="text-gradient-brand">edge</span> in every Tennis player prop.
        </h1>
        <p className="mt-4 text-pretty text-base text-muted sm:text-lg">
          Diamond Edge models serve/return analytics, surface-specific form, and opponent
          context with overall and surface Elo, then runs a point → game → set → match Monte
          Carlo to produce More/Less probabilities and fair lines.
        </p>
        <div className="mt-6 flex flex-wrap gap-3">
          <Link href="/tennis/matches">
            <Button size="lg">
              Explore today&apos;s slate <ArrowRight className="h-4 w-4" />
            </Button>
          </Link>
          <Link href="/tennis/players">
            <Button size="lg" variant="outline">
              Research a player
            </Button>
          </Link>
        </div>
      </div>
    </section>
  );
}

const FEATURES = [
  {
    icon: Cpu,
    title: "Projection engine",
    body: "Surface-adjusted and opponent-adjusted player projections from serve/return form and Elo.",
  },
  {
    icon: Dices,
    title: "Monte Carlo",
    body: "Structural point → game → set → match simulation, best-of-3 and best-of-5, seeded and deterministic.",
  },
  {
    icon: TrendingUp,
    title: "Model edge",
    body: "More/Less probabilities, fair lines, confidence, and volatility — kept as separate signals.",
  },
];

function FeatureStrip() {
  return (
    <section className="grid gap-4 sm:grid-cols-3">
      {FEATURES.map((f) => (
        <div key={f.title} className="glass rounded-2xl p-5">
          <div className="mb-3 grid h-10 w-10 place-items-center rounded-xl bg-brand-500/12 text-brand-500">
            <f.icon className="h-5 w-5" />
          </div>
          <h3 className="font-semibold">{f.title}</h3>
          <p className="mt-1 text-sm text-muted">{f.body}</p>
        </div>
      ))}
    </section>
  );
}
