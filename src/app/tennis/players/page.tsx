import { Users } from "lucide-react";
import { ProviderNotConfigured } from "@/components/tennis/states";
import { getTennisDataStatus } from "@/lib/tennis/status";

export const dynamic = "force-dynamic";
export const revalidate = 0;

export default function TennisPlayersPage() {
  const status = getTennisDataStatus();

  return (
    <div className="space-y-6">
      <header className="glass rounded-2xl p-6">
        <h1 className="flex items-center gap-2 text-2xl font-black tracking-tight">
          <Users className="h-6 w-6 text-brand-500" /> Players
        </h1>
        <p className="mt-1 text-sm text-muted">
          ATP and WTA player directory with rankings, surface splits, and serve/return
          profiles. Use the search bar above to look up a player by name.
        </p>
      </header>

      {status.liveConfigured ? (
        <div className="glass rounded-2xl p-6 text-center text-sm text-muted">
          Live provider connected — search a player from the bar above to open their profile.
        </div>
      ) : (
        <ProviderNotConfigured what="players" />
      )}
    </div>
  );
}
