import { NextResponse, type NextRequest } from "next/server";
import { runAnalysis } from "@/lib/mlb/analysis";
import type { Side } from "@/lib/analytics/hitRate";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

function num(v: string | null): number | undefined {
  if (v === null || v === "") return undefined;
  const n = Number(v);
  return Number.isFinite(n) ? n : undefined;
}

export async function GET(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  const { id } = await params;
  const playerId = Number(id);
  if (!Number.isFinite(playerId)) {
    return NextResponse.json({ error: "invalid_player_id" }, { status: 400 });
  }

  const sp = req.nextUrl.searchParams;
  const propKey = sp.get("prop") ?? "hits";
  const venueSplitParam = sp.get("venue");
  const venueSplit =
    venueSplitParam === "home" || venueSplitParam === "away" ? venueSplitParam : undefined;

  try {
    const payload = await runAnalysis({
      playerId,
      propKey,
      line: num(sp.get("line")),
      side: (sp.get("side") as Side) ?? undefined,
      overAmerican: num(sp.get("over")),
      underAmerican: num(sp.get("under")),
      venueName: sp.get("venueName") ?? undefined,
      tempF: num(sp.get("temp")),
      venueSplit,
      lastN: num(sp.get("lastN")),
      season: num(sp.get("season")),
      multiSeason: sp.get("multiSeason") === "1",
    });
    return NextResponse.json(payload);
  } catch (err) {
    return NextResponse.json(
      { error: "analysis_failed", detail: err instanceof Error ? err.message : String(err) },
      { status: 502 },
    );
  }
}
