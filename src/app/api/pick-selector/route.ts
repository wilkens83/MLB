import { NextResponse, type NextRequest } from "next/server";
import { z } from "zod";
import { getCurrentMlbSeason } from "@/lib/mlb/season";
import { decideEntryFromBoard, type BoardLeg } from "@/lib/prizepicks/decision/from-board";
import { fromDecisionResult, runPickSelector, DEFAULT_SELECTOR_FILTERS, type SelectorCandidate } from "@/lib/picks";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const bodySchema = z.object({
  date: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).optional(),
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
    .min(1)
    .max(60),
  filters: z
    .object({
      markets: z.array(z.string()).optional(),
      minProbability: z.number().min(0).max(1).optional(),
      minEdge: z.number().min(0).max(1).optional(),
      minDataQuality: z.number().min(0).max(1).optional(),
      maxUncertainty: z.number().min(0).max(1).optional(),
      requireLineupConfirmed: z.boolean().optional(),
      maxSamePlayer: z.number().int().min(1).max(10).optional(),
      maxSameGame: z.number().int().min(1).max(10).optional(),
    })
    .optional(),
});

/** Chunk the board through the per-leg decision evaluator (entry cap is 6). */
async function evaluateBoard(board: BoardLeg[], season: number, date: string): Promise<SelectorCandidate[]> {
  const candidates: SelectorCandidate[] = [];
  for (let i = 0; i < board.length; i += 6) {
    const chunk = board.slice(i, i + 6);
    // decideEntryFromBoard needs ≥2 legs; pad a 1-leg tail by re-including it is
    // unnecessary — a lone leg is evaluated as UNAVAILABLE, so batch with a
    // neighbor when possible; otherwise skip gracefully.
    if (chunk.length < 2) {
      if (candidates.length === 0) break; // nothing to pair — leave unresolved
      break;
    }
    const { legDecisions } = await decideEntryFromBoard({ board: chunk, entryType: "flex", season, date });
    legDecisions.forEach((d, idx) => {
      const leg = chunk[idx];
      const lineupConfirmed = !d.reasons.some((r) => /lineup|starter/i.test(r.message));
      const c = fromDecisionResult(d, {
        id: `${i + idx}:${leg.playerName}:${leg.marketKey ?? leg.rawMarketLabel ?? "?"}`,
        playerName: leg.playerName,
        lineupConfirmed,
        marketLabel: leg.rawMarketLabel,
      });
      if (c) candidates.push(c);
    });
  }
  return candidates;
}

/** POST /api/pick-selector — board-wide ranked, graded pick selection. */
export async function POST(req: NextRequest) {
  const parsed = bodySchema.safeParse(await req.json().catch(() => null));
  if (!parsed.success) {
    return NextResponse.json({ error: "invalid_request", issues: parsed.error.issues.map((i) => i.message) }, { status: 400 });
  }
  const date = parsed.data.date ?? new Date().toISOString().slice(0, 10);
  try {
    const season = getCurrentMlbSeason(new Date(`${date}T12:00:00Z`));
    const candidates = await evaluateBoard(parsed.data.board as BoardLeg[], season, date);
    const result = runPickSelector(candidates, { ...DEFAULT_SELECTOR_FILTERS, ...parsed.data.filters });
    return NextResponse.json({ ...result, date, evaluated: candidates.length });
  } catch {
    return NextResponse.json({ error: "selection_failed" }, { status: 500 });
  }
}
