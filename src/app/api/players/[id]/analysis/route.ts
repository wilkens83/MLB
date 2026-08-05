import { NextResponse, type NextRequest } from "next/server";
import { runAnalysis } from "@/lib/mlb/analysis";
import type { Side } from "@/lib/analytics/hitRate";
import { runPlayerPropWorkflow } from "@/workflows/player-prop/workflow";
import { mlbSeriesAdapter } from "@/workflows/player-prop/mlb-adapter";
import { success, failure, statusForErrorCode } from "@/lib/http/envelope";

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

  // Opt-in graph-workflow path (new architecture). Default behavior is unchanged:
  // the existing runAnalysis payload is returned when `engine` is not "graph".
  if (sp.get("engine") === "graph") {
    try {
      const { result, trace } = await runPlayerPropWorkflow(
        {
          playerId, propKey,
          line: num(sp.get("line")),
          side: (sp.get("side") as Side) ?? undefined,
          overAmerican: num(sp.get("over")),
          underAmerican: num(sp.get("under")),
          season: num(sp.get("season")),
        },
        mlbSeriesAdapter,
      );
      if (!result.ok) {
        return NextResponse.json(failure(result.error.code, result.error.message, result.error.retryable), {
          status: statusForErrorCode(result.error.code),
        });
      }
      return NextResponse.json(
        success({ recommendation: result.value, trace }, { warnings: trace.warnings, dataFreshness: "gameLog" }),
      );
    } catch (e) {
      return NextResponse.json(failure("VALIDATION", e instanceof Error ? e.message : "bad request", false), { status: 400 });
    }
  }

  try {
    const payload = await runAnalysis({
      playerId,
      propKey,
      line: num(sp.get("line")),
      side: (sp.get("side") as Side) ?? undefined,
      overAmerican: num(sp.get("over")),
      underAmerican: num(sp.get("under")),
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
