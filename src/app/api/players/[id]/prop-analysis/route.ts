import { NextResponse, type NextRequest } from "next/server";
import { runPropAnalysisV2 } from "@/workflows/player-prop-analysis-v2";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

function num(v: string | null): number | undefined {
  if (v === null || v === "") return undefined;
  const n = Number(v);
  return Number.isFinite(n) ? n : undefined;
}

/**
 * Research view model for the player-prop analysis page. Assembles one typed
 * PlayerPropAnalysisViewModel via the player-prop-analysis@2 graph workflow
 * (which reuses the canonical analysis + scientific engines). All scientific
 * calculation happens server-side; the frontend only renders these fields.
 */
export async function GET(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const playerId = Number(id);
  if (!Number.isFinite(playerId)) {
    return NextResponse.json({ error: "invalid_player_id" }, { status: 400 });
  }

  const sp = req.nextUrl.searchParams;
  const market = sp.get("market") ?? "strikeouts";
  const lineSourceParam = sp.get("lineSource");
  const lineSource =
    lineSourceParam === "prizepicks" || lineSourceParam === "manual" ? lineSourceParam : undefined;

  try {
    const { result } = await runPropAnalysisV2({
      playerId,
      market,
      line: num(sp.get("line")),
      window: num(sp.get("window")),
      lineSource,
      lineCapturedAt: sp.get("lineCapturedAt") ?? undefined,
    });
    if (!result.ok) {
      return NextResponse.json({ error: result.error.code, detail: result.error.message }, { status: 400 });
    }
    return NextResponse.json(result.value);
  } catch (err) {
    return NextResponse.json(
      { error: "analysis_failed", detail: err instanceof Error ? err.message : String(err) },
      { status: 502 },
    );
  }
}
