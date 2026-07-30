import { CalendarDays } from "lucide-react";
import { ProviderNotConfigured, EmptyMatches } from "@/components/tennis/states";
import { getTennisDataStatus } from "@/lib/tennis/status";
import type { TennisMatch } from "@/lib/tennis/domain";

export const dynamic = "force-dynamic";
export const revalidate = 0;

export default async function TennisMatchesPage() {
  const status = getTennisDataStatus();

  // With a live provider connected this is where the real slate would be fetched
  // via the acquisition facade. No provider ⇒ honest degraded state, never fixtures.
  const matches: TennisMatch[] = [];

  return (
    <div className="space-y-6">
      <header className="glass rounded-2xl p-6">
        <h1 className="flex items-center gap-2 text-2xl font-black tracking-tight">
          <CalendarDays className="h-6 w-6 text-brand-500" /> Today&apos;s Matches
        </h1>
        <p className="mt-1 text-sm text-muted">
          ATP, WTA and Challenger fixtures with tour, tournament, round, surface, rankings,
          scheduled time and status. Live data requires a connected provider.
        </p>
      </header>

      {!status.liveConfigured ? (
        <ProviderNotConfigured what="matches" />
      ) : matches.length === 0 ? (
        <EmptyMatches />
      ) : (
        <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
          {/* match cards render here once live data exists */}
        </div>
      )}
    </div>
  );
}
