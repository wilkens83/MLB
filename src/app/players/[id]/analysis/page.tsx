import { notFound } from "next/navigation";
import { getPlayer } from "@/lib/mlb/api";
import { PlayerWorkbench } from "@/components/slate/player-workbench";

export const dynamic = "force-dynamic";

export default async function PlayerAnalysisPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const playerId = Number(id);
  if (!Number.isFinite(playerId)) notFound();

  const player = await getPlayer(playerId).catch(() => null);
  if (!player) notFound();

  const isPitcher = player.primaryPosition?.abbreviation === "P";

  return (
    <PlayerWorkbench
      playerId={playerId}
      isPitcher={isPitcher}
      context={{
        teamId: player.currentTeam?.id,
        teamName: player.currentTeam?.name,
        position: player.primaryPosition?.abbreviation,
      }}
    />
  );
}
