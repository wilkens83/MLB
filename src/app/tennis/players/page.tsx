import Link from "next/link";
import { Users, ArrowRight } from "lucide-react";
import { StaleDataBadge } from "@/components/tennis/states";
import { getTennisDataStatus } from "@/lib/tennis/status";
import { getFreeDataset, freeRankingsAsOf } from "@/lib/tennis/data/freeDataset";
import type { TennisTour } from "@/lib/tennis/domain";

export const dynamic = "force-dynamic";
export const revalidate = 0;

const TOUR_LABEL: Record<string, string> = { atp: "ATP", wta: "WTA", challenger: "Challenger", itf: "ITF" };

export default function TennisPlayersPage() {
  const status = getTennisDataStatus();
  const ds = getFreeDataset();
  // Latest known rank per player (point-in-time: as of the dataset's coverage end).
  const asOf = `${ds.manifest.coverageEnd}T23:59:59Z`;
  const rankByPlayer = new Map<string, number>();
  for (const tour of ["atp", "wta"] as TennisTour[]) {
    for (const r of freeRankingsAsOf(tour, asOf, ds)) rankByPlayer.set(r.playerId, r.rank);
  }

  const byTour = (tour: TennisTour) =>
    ds.players
      .filter((p) => p.tour === tour)
      .map((p) => ({ ...p, rank: rankByPlayer.get(p.id) }))
      .sort((a, b) => (a.rank ?? 999) - (b.rank ?? 999));

  return (
    <div className="space-y-6">
      <header className="glass rounded-2xl p-6">
        <div className="flex flex-wrap items-center gap-3">
          <h1 className="flex items-center gap-2 text-2xl font-black tracking-tight">
            <Users className="h-6 w-6 text-brand-500" /> Players
          </h1>
          <StaleDataBadge label={`Historical · ${status.dataMode.label}`} />
        </div>
        <p className="mt-1 text-sm text-muted">
          ATP and WTA player directory from the free historical dataset
          ({ds.manifest.source} · {ds.manifest.datasetVersion}). Ranking, surface splits and
          serve/return profiles open on each player&apos;s page.
          {!status.liveConfigured && " No paid live feed is connected — this is real historical data, never fabricated."}
        </p>
      </header>

      <div className="grid gap-4 lg:grid-cols-2">
        {(["atp", "wta"] as TennisTour[]).map((tour) => (
          <section key={tour} className="glass rounded-2xl p-5">
            <h2 className="mb-3 font-semibold">{TOUR_LABEL[tour]}</h2>
            <ul className="divide-y divide-border/50">
              {byTour(tour).map((p) => (
                <li key={p.id}>
                  <Link
                    href={`/tennis/players/${encodeURIComponent(p.id)}`}
                    className="group flex items-center gap-3 py-2 transition hover:text-brand-500"
                  >
                    <span className="w-8 text-right text-sm tabular-nums text-muted-2">
                      {p.rank ?? "—"}
                    </span>
                    <span className="font-medium">{p.fullName}</span>
                    {p.countryCode && (
                      <span className="rounded-full border border-border px-1.5 py-0.5 text-[10px] uppercase tracking-wide text-muted-2">
                        {p.countryCode}
                      </span>
                    )}
                    <ArrowRight className="ml-auto h-4 w-4 opacity-0 transition group-hover:opacity-100" />
                  </Link>
                </li>
              ))}
            </ul>
          </section>
        ))}
      </div>
    </div>
  );
}
