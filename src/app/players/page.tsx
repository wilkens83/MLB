import Link from "next/link";
import { Users } from "lucide-react";
import { PlayerSearch } from "@/components/player-search";
import { Card } from "@/components/ui/card";
import { Badge } from "@/components/ui/primitives";
import { initials } from "@/lib/utils";

/** Curated stars for quick access (MLB Stats API person IDs). */
const FEATURED = [
  { id: 592450, name: "Aaron Judge", role: "OF · NYY" },
  { id: 660271, name: "Shohei Ohtani", role: "DH · LAD" },
  { id: 665742, name: "Juan Soto", role: "OF · NYM" },
  { id: 605141, name: "Mookie Betts", role: "IF · LAD" },
  { id: 683002, name: "Gunnar Henderson", role: "SS · BAL" },
  { id: 677594, name: "Bobby Witt Jr.", role: "SS · KC" },
  { id: 545361, name: "Mike Trout", role: "OF · LAA" },
  { id: 592789, name: "Corbin Burnes", role: "P · ARI" },
  { id: 668678, name: "Tarik Skubal", role: "P · DET" },
  { id: 594798, name: "Jacob deGrom", role: "P · TEX" },
  { id: 543037, name: "Gerrit Cole", role: "P · NYY" },
  { id: 671096, name: "Paul Skenes", role: "P · PIT" },
];

export default function PlayersPage() {
  return (
    <div className="space-y-8">
      <div className="glass rounded-2xl p-8">
        <Badge variant="brand" className="mb-3">
          <Users className="h-3 w-3" /> Player Research
        </Badge>
        <h1 className="text-3xl font-black tracking-tight">Search every MLB player</h1>
        <p className="mt-2 max-w-xl text-muted">
          Pull a full prop workbench — projections, hit rates, distributions, and EV — for any
          hitter or pitcher, powered by live box-score data.
        </p>
        <div className="mt-5 max-w-lg">
          <PlayerSearch autoFocus />
        </div>
      </div>

      <section>
        <h2 className="mb-4 text-lg font-bold">Featured players</h2>
        <div className="grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-4">
          {FEATURED.map((p) => (
            <Link key={p.id} href={`/players/${p.id}`}>
              <Card className="flex items-center gap-3 p-4 transition-transform hover:-translate-y-0.5">
                <span className="grid h-11 w-11 shrink-0 place-items-center rounded-full bg-brand-500/12 text-sm font-bold text-brand-500">
                  {initials(p.name)}
                </span>
                <div className="min-w-0">
                  <div className="truncate text-sm font-semibold">{p.name}</div>
                  <div className="truncate text-xs text-muted">{p.role}</div>
                </div>
              </Card>
            </Link>
          ))}
        </div>
      </section>
    </div>
  );
}
