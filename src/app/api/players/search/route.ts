import { NextResponse, type NextRequest } from "next/server";
import { searchPlayers } from "@/lib/mlb/api";
import { sortByRolePreference } from "@/lib/prizepicks/autocomplete";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET(req: NextRequest) {
  const sp = req.nextUrl.searchParams;
  const q = sp.get("q")?.trim() ?? "";
  // Optional role preference from the selected prop market. It only re-ORDERS
  // (pitchers or hitters first) — it never removes valid ambiguous matches, so a
  // two-way / mislabeled player is still selectable.
  const roleParam = sp.get("role");
  const role = roleParam === "pitcher" || roleParam === "batter" ? roleParam : undefined;

  if (q.length < 2) return NextResponse.json({ players: [] });
  try {
    const players = await searchPlayers(q);
    const mapped = players.map((p) => ({
      id: p.id,
      name: p.fullName,
      position: p.primaryPosition?.abbreviation ?? "",
      team: p.currentTeam?.name ?? "",
      teamId: p.currentTeam?.id,
      bats: p.batSide?.code,
      throws: p.pitchHand?.code,
      isPitcher: p.primaryPosition?.abbreviation === "P",
    }));
    return NextResponse.json({ players: sortByRolePreference(mapped, role).slice(0, 12) });
  } catch {
    return NextResponse.json({ players: [], error: "search_failed" }, { status: 502 });
  }
}
