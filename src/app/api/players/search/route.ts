import { NextResponse, type NextRequest } from "next/server";
import { searchPlayers } from "@/lib/mlb/api";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET(req: NextRequest) {
  const q = req.nextUrl.searchParams.get("q")?.trim() ?? "";
  if (q.length < 2) return NextResponse.json({ players: [] });
  try {
    const players = await searchPlayers(q);
    return NextResponse.json({
      players: players.slice(0, 12).map((p) => ({
        id: p.id,
        name: p.fullName,
        position: p.primaryPosition?.abbreviation ?? "",
        team: p.currentTeam?.name ?? "",
        bats: p.batSide?.code,
        throws: p.pitchHand?.code,
      })),
    });
  } catch {
    return NextResponse.json({ players: [], error: "search_failed" }, { status: 502 });
  }
}
