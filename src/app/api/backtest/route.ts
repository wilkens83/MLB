import { NextResponse, type NextRequest } from "next/server";
import { z } from "zod";
import { runLiveWalkForwardBacktest } from "@/lib/backtest/liveWalkForward";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

// Bounded: a walk-forward run replays every game of every series, so cap the
// input sizes so a single request can't fan out without limit.
const bodySchema = z.object({
  playerIds: z.array(z.number().int().positive()).min(1).max(12),
  propKeys: z.array(z.string().min(1)).min(1).max(6),
  minimumHistory: z.number().int().min(5).max(80).optional(),
  seasons: z.array(z.number().int()).max(4).optional(),
});

export async function POST(req: NextRequest) {
  let parsed: z.infer<typeof bodySchema>;
  try {
    parsed = bodySchema.parse(await req.json());
  } catch (e) {
    return NextResponse.json({ error: "invalid_request", detail: e instanceof Error ? e.message : "bad body" }, { status: 400 });
  }
  try {
    const report = await runLiveWalkForwardBacktest(parsed);
    return NextResponse.json(report);
  } catch (err) {
    return NextResponse.json({ error: "backtest_failed", detail: err instanceof Error ? err.message : String(err) }, { status: 502 });
  }
}
