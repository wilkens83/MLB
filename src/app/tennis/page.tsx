import Link from "next/link";
import { Activity, Cpu, Dices, TrendingUp, ArrowRight, Sparkles } from "lucide-react";
import { Button, Badge } from "@/components/ui/primitives";
import { ProviderNotConfigured } from "@/components/tennis/states";
import { getTennisDataStatus } from "@/lib/tennis/status";
import { TENNIS_MARKETS } from "@/lib/tennis/domain/markets";

export const dynamic = "force-dynamic";
export const revalidate = 0;

export default function TennisHomePage() {
  const status = getTennisDataStatus();

  return (
    <div className="space-y-10">
      <Hero />
      <FeatureStrip />
      <section>
        <div className="mb-4 flex items-end justify-between">
          <div>
            <h2 className="flex items-center gap-2 text-xl font-bold">
              <Activity className="h-5 w-5 text-brand-500" /> Today&apos;s Slate
            </h2>
            <p className="text-sm text-muted">ATP / WTA / Challenger matches, surfaces, and prop coverage.</p>
          </div>
          <Link href="/tennis/matches">
            <Button variant="ghost" size="sm">
              All matches <ArrowRight className="h-4 w-4" />
            </Button>
          </Link>
        </div>
        {status.liveConfigured ? (
          // A live provider is connected — the matches page renders the real slate.
          <div className="glass rounded-2xl p-6 text-center text-sm text-muted">
            Live provider connected.{" "}
            <Link href="/tennis/matches" className="text-brand-500 hover:underline">
              View today&apos;s matches
            </Link>
            .
          </div>
        ) : (
          <ProviderNotConfigured what="matches" />
        )}
      </section>
    </div>
  );
}

function Hero() {
  return (
    <section className="glass relative overflow-hidden rounded-2xl p-8 sm:p-12">
      <div className="absolute -right-20 -top-24 h-72 w-72 rounded-full bg-brand-500/20 blur-3xl" />
      <div className="relative max-w-2xl">
        <Badge variant="brand" className="mb-4">
          <Sparkles className="h-3 w-3" /> {TENNIS_MARKETS.length} tennis markets · structural simulation
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
