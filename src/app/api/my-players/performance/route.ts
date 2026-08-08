import { NextResponse, type NextRequest } from "next/server";
import { z } from "zod";
import { buildFollowedPerformance } from "@/lib/players/followed-performance";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

// The followed-player list is supplied by the client (it lives in the user's
// own store). Bounded so a request can never fan out without limit.
const bodySchema = z.object({
  players: z
    .array(
      z.object({
        playerId: z.number().int().positive(),
        metrics: z.array(z.string().min(1).max(40)).max(8).optional(),
      }),
    )
    .max(50),
  concurrency: z.number().int().positive().max(8).optional(),
});

export async function POST(req: NextRequest) {
  let parsed: z.infer<typeof bodySchema>;
  try {
    parsed = bodySchema.parse(await req.json());
  } catch (e) {
    return NextResponse.json(
      { error: "invalid_request", detail: e instanceof Error ? e.message : "bad body" },
      { status: 400 },
    );
  }

  try {
    const dashboard = await buildFollowedPerformance(parsed.players, { concurrency: parsed.concurrency });
    return NextResponse.json(dashboard);
  } catch (err) {
    return NextResponse.json(
      { error: "performance_failed", detail: err instanceof Error ? err.message : String(err) },
      { status: 502 },
    );
  }
}
