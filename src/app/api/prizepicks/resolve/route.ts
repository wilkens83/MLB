import { NextResponse, type NextRequest } from "next/server";
import { resolvePlayer } from "@/lib/prizepicks/player-resolver";
import type { MarketCategory } from "@/lib/prizepicks/types";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET(req: NextRequest) {
  const sp = req.nextUrl.searchParams;
  const name = sp.get("name")?.trim();
  const date = sp.get("date") ?? new Date().toISOString().slice(0, 10);
  const team = sp.get("team") ?? undefined;
  const cat = sp.get("category");
  const categoryHint = cat === "pitcher" || cat === "hitter" ? (cat as MarketCategory) : undefined;

  if (!name) return NextResponse.json({ error: "name required" }, { status: 400 });
  try {
    const resolution = await resolvePlayer({ rawPlayerName: name, boardDate: date, teamAbbreviation: team, categoryHint });
    return NextResponse.json(resolution);
  } catch {
    return NextResponse.json({ status: "not-found", candidates: [], reason: "resolve_failed" }, { status: 502 });
  }
}
