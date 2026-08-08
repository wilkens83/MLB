/* ============================================================================
   GET /api/prizepicks/lines?date=YYYY-MM-DD — reload the persisted canonical line
   snapshots for a board date from the configured store (Supabase when a
   service-role key is set, else the in-memory baseline). Lets the board rehydrate
   from persistence instead of requiring a fresh manual import each visit.
   ========================================================================== */

import { NextResponse, type NextRequest } from "next/server";
import { getLineSnapshotStore } from "@/lib/prizepicks/ingestion/snapshotStore";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET(req: NextRequest) {
  const date = req.nextUrl.searchParams.get("date") ?? new Date().toISOString().slice(0, 10);
  if (!/^\d{4}-\d{2}-\d{2}$/.test(date)) {
    return NextResponse.json({ error: "date must be YYYY-MM-DD" }, { status: 400 });
  }
  try {
    const snapshots = await getLineSnapshotStore().list(date);
    return NextResponse.json({ boardDate: date, count: snapshots.length, snapshots });
  } catch (e) {
    return NextResponse.json({ error: "lines_read_failed", message: e instanceof Error ? e.message : "unknown" }, { status: 502 });
  }
}
