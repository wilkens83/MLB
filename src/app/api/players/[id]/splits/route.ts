import { NextResponse, type NextRequest } from "next/server";
import { getPlayer, getPlayerSplits, CURRENT_SEASON } from "@/lib/mlb/api";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const playerId = Number(id);
  if (!Number.isFinite(playerId)) return NextResponse.json({ error: "invalid_player_id" }, { status: 400 });

  const season = Number(req.nextUrl.searchParams.get("season")) || CURRENT_SEASON;
  try {
    const player = await getPlayer(playerId).catch(() => null);
    const group = player?.primaryPosition?.abbreviation === "P" ? "pitching" : "hitting";
    const splits = await getPlayerSplits(playerId, group, season);
    return NextResponse.json({ group, season, splits });
  } catch {
    return NextResponse.json({ splits: [], error: "splits_failed" }, { status: 502 });
  }
}
