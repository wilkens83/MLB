import { NextResponse, type NextRequest } from "next/server";
import { evaluateEntry, type EvaluateInput } from "@/lib/prizepicks/evaluate";
import { computeRanking } from "@/lib/prizepicks/ranking";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * POST { entries: [{ entryId, mlbPlayerId, marketKey, line, gamePk?, lineCapturedAt? }] }
 * Returns evaluation + experimental ranking for each resolved entry. Reuses the
 * existing engine; the imported line is only a threshold.
 */
export async function POST(req: NextRequest) {
  let body: { entries?: (EvaluateInput & { lineCapturedAt?: string })[] };
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: "invalid_json" }, { status: 400 });
  }
  const entries = body.entries ?? [];
  if (entries.length === 0) return NextResponse.json({ results: [] });
  if (entries.length > 60) return NextResponse.json({ error: "too_many_entries" }, { status: 413 });

  const now = Date.now();
  const results = await Promise.all(
    entries.map(async (e) => {
      try {
        const evaluation = await evaluateEntry(e);
        if (!evaluation) return { entryId: e.entryId, evaluation: null, ranking: null };
        const lineAgeMs = e.lineCapturedAt ? now - new Date(e.lineCapturedAt).getTime() : undefined;
        const ranking = computeRanking(evaluation, { resolved: true, lineAgeMs });
        return { entryId: e.entryId, evaluation, ranking };
      } catch {
        return { entryId: e.entryId, evaluation: null, ranking: null };
      }
    }),
  );

  return NextResponse.json({ results, calculatedAt: new Date().toISOString() });
}
