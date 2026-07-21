import Link from "next/link";
import { Users } from "lucide-react";
import { PlayerSearch } from "@/components/player-search";
import { PlayerAvatar } from "@/components/player-avatar";

/** Curated stars for quick access (MLB Stats API person IDs). */
const FEATURED = [
  { id: 592450, name: "Aaron Judge", role: "OF · NYY", teamId: 147 },
  { id: 660271, name: "Shohei Ohtani", role: "DH · LAD", teamId: 119 },
  { id: 665742, name: "Juan Soto", role: "OF · NYM", teamId: 121 },
  { id: 605141, name: "Mookie Betts", role: "IF · LAD", teamId: 119 },
  { id: 683002, name: "Gunnar Henderson", role: "SS · BAL", teamId: 110 },
  { id: 677594, name: "Bobby Witt Jr.", role: "SS · KC", teamId: 118 },
  { id: 545361, name: "Mike Trout", role: "OF · LAA", teamId: 108 },
  { id: 592789, name: "Corbin Burnes", role: "P · ARI", teamId: 109 },
  { id: 668678, name: "Tarik Skubal", role: "P · DET", teamId: 116 },
  { id: 594798, name: "Jacob deGrom", role: "P · TEX", teamId: 140 },
  { id: 543037, name: "Gerrit Cole", role: "P · NYY", teamId: 147 },
  { id: 671096, name: "Paul Skenes", role: "P · PIT", teamId: 134 },
];

export default function PlayersPage() {
  return (
    <div className="space-y-6">
      <div className="panel p-6">
        <div className="mb-2 inline-flex items-center gap-1.5 rounded-md border border-border bg-surface-2 px-2 py-0.5 text-[11px] font-medium text-muted">
          <Users className="h-3 w-3" /> Player Research
        </div>
        <h1 className="text-2xl font-black tracking-tight">Search every MLB player</h1>
        <p className="mt-1.5 max-w-xl text-sm text-muted">
          Pull a full analytics workbench — projections, hit rates, Statcast, splits, matchup, and
          Monte Carlo simulation — for any hitter or pitcher, on live data.
        </p>
        <div className="mt-4 max-w-lg">
          <PlayerSearch autoFocus />
        </div>
      </div>

      <section>
        <h2 className="mb-3 text-[13px] font-semibold uppercase tracking-wider text-muted">Featured players</h2>
        <div className="grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-4">
          {FEATURED.map((p) => (
            <Link
              key={p.id}
              href={`/players/${p.id}/analysis`}
              className="panel flex items-center gap-3 p-3 transition-colors hover:border-border-strong hover:bg-surface-hover"
            >
              <PlayerAvatar playerId={p.id} name={p.name} teamId={p.teamId} size="md" shape="rounded" />
              <div className="min-w-0">
                <div className="truncate text-sm font-semibold">{p.name}</div>
                <div className="truncate text-xs text-muted">{p.role}</div>
              </div>
            </Link>
          ))}
        </div>
      </section>
    </div>
  );
}
