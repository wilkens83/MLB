import { NextResponse, type NextRequest } from "next/server";
import { getPlayer } from "@/lib/mlb/api";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * Lightweight identity resolution for a set of canonical MLBAM player ids →
 * { id, name, team, position }. Used by the My Players view to label favorites
 * without computing full performance. Bounded to 50 ids; getPlayer is cached.
 */
export async function GET(req: NextRequest) {
  const raw = req.nextUrl.searchParams.get("ids") ?? "";
  const ids = [...new Set(raw.split(",").map((s) => Number(s.trim())).filter((n) => Number.isFinite(n) && n > 0))].slice(0, 50);
  if (ids.length === 0) return NextResponse.json({ players: [] });

  const players = await Promise.all(
    ids.map(async (id) => {
      const p = await getPlayer(id).catch(() => null);
      return {
        id,
        name: p?.fullName ?? null,
        team: p?.currentTeam?.name ?? null,
        position: p?.primaryPosition?.abbreviation ?? null,
      };
    }),
  );
  return NextResponse.json({ players });
}
