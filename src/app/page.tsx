import Link from "next/link";
import { Suspense } from "react";
import { Activity, Cpu, Dices, TrendingUp, ArrowRight, Sparkles } from "lucide-react";
import { getTodaysGames } from "@/lib/mlb/api";
import { GameCard } from "@/components/game-card";
import { Skeleton, Button, Badge } from "@/components/ui/primitives";
import { PROP_CATALOG } from "@/lib/props/catalog";

export const dynamic = "force-dynamic";
export const revalidate = 0;

export default function HomePage() {
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
            <p className="text-sm text-muted">Live games, probable pitchers, and prop coverage.</p>
          </div>
          <Link href="/games">
            <Button variant="ghost" size="sm">
              All games <ArrowRight className="h-4 w-4" />
            </Button>
          </Link>
        </div>
        <Suspense fallback={<GamesSkeleton />}>
          <TodaysGames />
        </Suspense>
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
          <Sparkles className="h-3 w-3" /> {PROP_CATALOG.length} prop markets · live MLB data
        </Badge>
        <h1 className="text-balance text-4xl font-black leading-[1.05] tracking-tight sm:text-5xl">
          Find the <span className="text-gradient-brand">edge</span> in every MLB player prop.
        </h1>
        <p className="mt-4 text-pretty text-base text-muted sm:text-lg">
          Diamond Edge blends live box-score history, ballpark and weather context, and a
          10,000-iteration Monte Carlo engine to project true probabilities — then surfaces the
          positive-EV side against the market.
        </p>
        <div className="mt-6 flex flex-wrap gap-3">
          <Link href="/games">
            <Button size="lg">
              Explore today&apos;s slate <ArrowRight className="h-4 w-4" />
            </Button>
          </Link>
          <Link href="/players">
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
    body: "Recency-weighted, Bayesian-shrunk rate estimates adjusted for park, weather, and matchup.",
  },
  {
    icon: Dices,
    title: "Monte Carlo",
    body: "10k simulations per prop with Poisson / negative-binomial models and full distributions.",
  },
  {
    icon: TrendingUp,
    title: "Positive EV",
    body: "Implied vs model probability, no-vig fair lines, edge %, and quarter-Kelly staking.",
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

async function TodaysGames() {
  let games;
  try {
    games = await getTodaysGames();
  } catch {
    return (
      <div className="glass rounded-2xl p-6 text-center text-sm text-muted">
        Live schedule is temporarily unavailable. Please retry shortly.
      </div>
    );
  }

  if (games.length === 0) {
    return (
      <div className="glass rounded-2xl p-8 text-center">
        <p className="font-medium">No games scheduled today.</p>
        <p className="mt-1 text-sm text-muted">Check the games page for upcoming slates.</p>
      </div>
    );
  }

  const sorted = [...games].sort((a, b) => {
    const rank = (s: string) => (s === "Live" ? 0 : s === "Preview" ? 1 : 2);
    return rank(a.status.abstractGameState) - rank(b.status.abstractGameState);
  });

  return (
    <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
      {sorted.map((g, i) => (
        <GameCard key={g.gamePk} game={g} index={i} />
      ))}
    </div>
  );
}

function GamesSkeleton() {
  return (
    <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
      {Array.from({ length: 6 }).map((_, i) => (
        <Skeleton key={i} className="h-40 rounded-2xl" />
      ))}
    </div>
  );
}
