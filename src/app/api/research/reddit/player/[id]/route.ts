import { NextResponse, type NextRequest } from "next/server";
import { getPlayerResearch } from "@/lib/research/service";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * Reddit MLB News & Trend Intelligence for a player. Returns verified,
 * deduplicated ContextEvents plus secondary sentiment/trend. When Reddit is
 * disabled/unavailable the payload is `{ status: "unavailable", events: [] }` —
 * never fabricated content. This never modifies any model probability.
 */
export async function GET(_req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const playerId = Number(id);
  if (!Number.isFinite(playerId)) {
    return NextResponse.json({ error: "invalid_player_id" }, { status: 400 });
  }
  const research = await getPlayerResearch(playerId);
  return NextResponse.json(research);
}
