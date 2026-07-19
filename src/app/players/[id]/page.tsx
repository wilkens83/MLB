import Link from "next/link";
import { notFound } from "next/navigation";
import { ArrowLeft } from "lucide-react";
import { getPlayer } from "@/lib/mlb/api";
import { PropDashboard } from "@/components/prop/prop-dashboard";
import { TeamLogo } from "@/components/team-logo";
import { Badge } from "@/components/ui/primitives";
import type { PropCategory } from "@/lib/props/catalog";

export const dynamic = "force-dynamic";

export default async function PlayerPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const playerId = Number(id);
  if (!Number.isFinite(playerId)) notFound();

  const player = await getPlayer(playerId).catch(() => null);
  if (!player) notFound();

  const isPitcher = player.primaryPosition?.abbreviation === "P";
  const categories: PropCategory[] = isPitcher ? ["pitcher"] : ["batter"];
  const initialProp = isPitcher ? "strikeouts" : "hits";

  return (
    <div className="space-y-6">
      <Link href="/players" className="inline-flex items-center gap-1 text-sm text-muted hover:text-foreground">
        <ArrowLeft className="h-4 w-4" /> Players
      </Link>

      <div className="glass flex flex-wrap items-center gap-4 rounded-2xl p-5">
        <TeamLogo teamId={player.currentTeam?.id} name={player.currentTeam?.name ?? player.fullName} size={56} />
        <div className="min-w-0">
          <h1 className="text-2xl font-black tracking-tight">{player.fullName}</h1>
          <div className="mt-1 flex flex-wrap items-center gap-2 text-sm text-muted">
            <span>{player.currentTeam?.name ?? "Free agent"}</span>
            <span className="text-muted-2">·</span>
            <span>{player.primaryPosition?.name}</span>
            {player.primaryNumber && <span className="text-muted-2">#{player.primaryNumber}</span>}
          </div>
        </div>
        <div className="ml-auto flex gap-2">
          {player.batSide?.code && <Badge variant="outline">Bats {player.batSide.code}</Badge>}
          {player.pitchHand?.code && <Badge variant="outline">Throws {player.pitchHand.code}</Badge>}
          <Badge variant={isPitcher ? "info" : "brand"}>{isPitcher ? "Pitcher" : "Hitter"}</Badge>
        </div>
      </div>

      <PropDashboard playerId={playerId} categories={categories} initialProp={initialProp} />
    </div>
  );
}
