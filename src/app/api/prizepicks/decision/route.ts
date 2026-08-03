import { NextResponse, type NextRequest } from "next/server";
import { z } from "zod";
import { getCurrentMlbSeason } from "@/lib/mlb/season";
import { decideEntryFromBoard } from "@/lib/prizepicks/decision/from-board";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const bodySchema = z.object({
  entryType: z.enum(["power", "flex"]).default("flex"),
  date: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).optional(),
  assumeValidatedMarkets: z.boolean().optional(),
  board: z
    .array(
      z.object({
        playerName: z.string(),
        marketKey: z.string().optional(),
        rawMarketLabel: z.string().optional(),
        line: z.number(),
        mlbPlayerId: z.number().optional(),
      }),
    )
    .max(6),
});

/** POST /api/prizepicks/decision — canonical firm decision for a complete entry. */
export async function POST(req: NextRequest) {
  const parsed = bodySchema.safeParse(await req.json().catch(() => null));
  if (!parsed.success) {
    return NextResponse.json({ error: "invalid_request", issues: parsed.error.issues.map((i) => i.message) }, { status: 400 });
  }
  const date = parsed.data.date ?? new Date().toISOString().slice(0, 10);
  try {
    const result = await decideEntryFromBoard({
      board: parsed.data.board,
      entryType: parsed.data.entryType,
      season: getCurrentMlbSeason(new Date(`${date}T12:00:00Z`)),
      date,
      assumeValidatedMarkets: parsed.data.assumeValidatedMarkets,
    });
    return NextResponse.json(result);
  } catch {
    return NextResponse.json({ error: "decision_failed" }, { status: 500 });
  }
}
