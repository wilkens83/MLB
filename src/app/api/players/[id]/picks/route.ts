/* ============================================================================
   Player Picks API. Analyzes every supported prop for one player and returns
   ranked Top Picks + All Props + projection-only props. Reuses the existing
   engine end-to-end (`analyzePlayerPicks` → `runAnalysis`).

   GET  /api/players/[id]/picks?date=YYYY-MM-DD
        Projection-first read — the server holds no market lines, so props with
        no supplied line come back as projection-only (never a fabricated pick).

   POST /api/players/[id]/picks   { date?, lines? }
        Same analysis, augmented with the caller's imported PrizePicks lines
        (the board store is client-side). Lines are only thresholds.
   ========================================================================== */

import { NextResponse, type NextRequest } from "next/server";
import { z } from "zod";
import { analyzePlayerPicks, importedLineSchema } from "@/lib/picks";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const DATE_RE = /^\d{4}-\d{2}-\d{2}$/;

function parsePlayerId(id: string): number | null {
  return /^\d+$/.test(id) ? Number(id) : null;
}

export async function GET(req: NextRequest, ctx: { params: Promise<{ id: string }> }) {
  const { id } = await ctx.params;
  const playerId = parsePlayerId(id);
  if (playerId === null) return NextResponse.json({ error: "invalid_player_id" }, { status: 400 });

  const dateParam = req.nextUrl.searchParams.get("date") ?? undefined;
  const date = dateParam && DATE_RE.test(dateParam) ? dateParam : undefined;

  try {
    const result = await analyzePlayerPicks({ playerId, date });
    return NextResponse.json(result);
  } catch (e) {
    return NextResponse.json({ error: "picks_failed", message: e instanceof Error ? e.message : "unknown" }, { status: 502 });
  }
}

const bodySchema = z.object({
  date: z.string().regex(DATE_RE).optional(),
  lines: z.array(importedLineSchema).max(40).optional(),
});

export async function POST(req: NextRequest, ctx: { params: Promise<{ id: string }> }) {
  const { id } = await ctx.params;
  const playerId = parsePlayerId(id);
  if (playerId === null) return NextResponse.json({ error: "invalid_player_id" }, { status: 400 });

  let raw: unknown;
  try {
    raw = await req.json();
  } catch {
    return NextResponse.json({ error: "invalid_json" }, { status: 400 });
  }
  const parsed = bodySchema.safeParse(raw ?? {});
  if (!parsed.success) {
    return NextResponse.json({ error: parsed.error.issues[0]?.message ?? "invalid_body" }, { status: 400 });
  }

  try {
    const result = await analyzePlayerPicks({ playerId, date: parsed.data.date, lines: parsed.data.lines });
    return NextResponse.json(result);
  } catch (e) {
    return NextResponse.json({ error: "picks_failed", message: e instanceof Error ? e.message : "unknown" }, { status: 502 });
  }
}
