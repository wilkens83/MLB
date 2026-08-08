/* ============================================================================
   POST /api/prizepicks/import — run prizepicks-import@1 over CSV (or pre-parsed
   rows) and persist canonical line snapshots. This browser-facing route NEVER
   accepts review decisions: `reviews` is stripped, so an import can only ever
   produce IMPORTED / NEEDS_REVIEW / REJECTED — never VERIFIED. Verification
   requires the trusted (server) review path. (Success gate: browser cannot mark
   a line verified without trusted validation/review.)
   ========================================================================== */

import { NextResponse, type NextRequest } from "next/server";
import { z } from "zod";
import { runPrizePicksImportWorkflow } from "@/workflows/prizepicks-import";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const MAX_BYTES = 512 * 1024; // guard against oversized pastes

// Note: `reviews` is intentionally NOT part of this schema — the browser import
// path is not a trusted verifier.
const bodySchema = z.object({
  boardDate: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
  source: z.enum(["manual", "csv", "reviewed-image-import", "browser-assisted-import"]).default("csv"),
  sourceReference: z.string().max(300).optional(),
  csvText: z.string().max(MAX_BYTES).optional(),
  rows: z.array(z.unknown()).max(2000).optional(),
});

export async function POST(req: NextRequest) {
  let raw: unknown;
  try {
    raw = await req.json();
  } catch {
    return NextResponse.json({ error: "invalid JSON body" }, { status: 400 });
  }
  const parsed = bodySchema.safeParse(raw);
  if (!parsed.success) {
    return NextResponse.json({ error: parsed.error.issues[0]?.message ?? "invalid body" }, { status: 400 });
  }
  if (!parsed.data.csvText && !parsed.data.rows) {
    return NextResponse.json({ error: "provide csvText or rows" }, { status: 400 });
  }
  try {
    // No `reviews` passed ⇒ nothing can be VERIFIED through this route.
    const { result } = await runPrizePicksImportWorkflow({
      boardDate: parsed.data.boardDate,
      source: parsed.data.source,
      sourceReference: parsed.data.sourceReference,
      csvText: parsed.data.csvText,
      rows: parsed.data.rows as never,
    });
    if (!result.ok) {
      return NextResponse.json({ error: result.error.code, message: result.error.message }, { status: 502 });
    }
    return NextResponse.json(result.value);
  } catch (e) {
    return NextResponse.json({ error: "import_failed", message: e instanceof Error ? e.message : "unknown" }, { status: 502 });
  }
}
