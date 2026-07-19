import { NextResponse, type NextRequest } from "next/server";
import { getSchedule, getTodaysGames } from "@/lib/mlb/api";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET(req: NextRequest) {
  const date = req.nextUrl.searchParams.get("date");
  try {
    const games = date ? await getSchedule(date) : await getTodaysGames();
    return NextResponse.json({ count: games.length, games });
  } catch {
    return NextResponse.json({ count: 0, games: [], error: "schedule_failed" }, { status: 502 });
  }
}
