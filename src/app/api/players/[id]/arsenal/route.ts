import { NextResponse, type NextRequest } from "next/server";
import { getPitcherArsenal } from "@/lib/providers/arsenal";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const playerId = Number(id);
  if (!Number.isFinite(playerId)) return NextResponse.json({ error: "invalid_player_id" }, { status: 400 });
  const season = Number(req.nextUrl.searchParams.get("season")) || undefined;
  try {
    const arsenal = await getPitcherArsenal(playerId, season);
    return NextResponse.json({ arsenal });
  } catch {
    return NextResponse.json({ arsenal: null, error: "arsenal_failed" }, { status: 502 });
  }
}
