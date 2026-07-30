import Link from "next/link";
import { Microscope, ArrowRight } from "lucide-react";
import { TENNIS_MARKETS } from "@/lib/tennis/domain/markets";
import { EmptyProjections, ProviderNotConfigured } from "@/components/tennis/states";
import { getTennisDataStatus } from "@/lib/tennis/status";

export const dynamic = "force-dynamic";
export const revalidate = 0;

const PRIORITY = new Set([
  "aces", "double_faults", "total_games", "player_games_won", "total_sets", "tiebreak_in_match",
]);

export default function TennisProjectionsPage() {
  const status = getTennisDataStatus();
  const markets = [...TENNIS_MARKETS].sort(
    (a, b) => Number(PRIORITY.has(b.key)) - Number(PRIORITY.has(a.key)),
  );

  return (
    <div className="space-y-6">
      <header className="glass rounded-2xl p-6">
        <h1 className="flex items-center gap-2 text-2xl font-black tracking-tight">
          <Microscope className="h-6 w-6 text-brand-500" /> Prop Explorer
        </h1>
        <p className="mt-1 text-sm text-muted">
          Explore the tennis markets the structural model projects. Open a market to run a
          projection once a live slate and player inputs are connected.
        </p>
      </header>

      <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
        {markets.map((m) => (
          <Link
            key={m.key}
            href={`/tennis/projections/${m.key}`}
            className="glass group rounded-2xl p-5 transition-shadow hover:shadow-md"
          >
            <div className="flex items-center justify-between">
              <span className="text-xs font-semibold uppercase tracking-wider text-brand-500">{m.group}</span>
              {PRIORITY.has(m.key) && (
                <span className="rounded-full bg-brand-500/12 px-2 py-0.5 text-[10px] font-semibold text-brand-500">Core</span>
              )}
            </div>
            <h3 className="mt-1.5 flex items-center gap-1 font-semibold">
              {m.label}
              <ArrowRight className="h-4 w-4 -translate-x-1 text-muted-2 opacity-0 transition-all group-hover:translate-x-0 group-hover:opacity-100" />
            </h3>
            <p className="mt-1 text-sm text-muted">{m.description}</p>
          </Link>
        ))}
      </div>

      {status.liveConfigured ? <EmptyProjections /> : <ProviderNotConfigured what="projections" />}
    </div>
  );
}
