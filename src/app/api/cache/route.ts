import { NextResponse } from "next/server";
import { mlbCacheStats, clearMlbCache } from "@/lib/mlb/client";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET() {
  return NextResponse.json({ cache: mlbCacheStats() });
}

export async function DELETE() {
  const cleared = clearMlbCache();
  return NextResponse.json({ cleared });
}
