import { Suspense } from "react";
import { notFound } from "next/navigation";
import { getPlayer } from "@/lib/mlb/api";
import { PropAnalysisView } from "@/features/players/prop-analysis/prop-analysis-view";

export const dynamic = "force-dynamic";

export default async function PlayerAnalysisPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const playerId = Number(id);
  if (!Number.isFinite(playerId)) notFound();

  const player = await getPlayer(playerId).catch(() => null);
  if (!player) notFound();

  const isPitcher = player.primaryPosition?.abbreviation === "P";

  return (
    <Suspense fallback={<div className="h-96 animate-pulse rounded-2xl bg-surface-2" />}>
      <PropAnalysisView playerId={playerId} isPitcher={isPitcher} initialTeamId={player.currentTeam?.id} />
    </Suspense>
  );
}
