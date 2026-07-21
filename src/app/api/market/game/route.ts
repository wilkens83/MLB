import { NextResponse, type NextRequest } from "next/server";
import { computeMarketGameCards } from "@/lib/mlb/market";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET(req: NextRequest) {
  const sp = req.nextUrl.searchParams;
  const gamePk = Number(sp.get("gamePk"));
  const market = sp.get("market") ?? "hits";
  if (!Number.isFinite(gamePk)) {
    return NextResponse.json({ error: "invalid_gamePk", cards: [] }, { status: 400 });
  }
  const season = Number(sp.get("season")) || undefined;
  try {
    const result = await computeMarketGameCards(gamePk, market, season);
    return NextResponse.json(result);
  } catch (err) {
    return NextResponse.json(
      { gamePk, market, cards: [], lastUpdated: Date.now(), error: err instanceof Error ? err.message : "market_failed" },
      { status: 502 },
    );
  }
}
