import { NextResponse, type NextRequest } from "next/server";
import { buildSlate } from "@/lib/mlb/slate";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET(req: NextRequest) {
  const date = req.nextUrl.searchParams.get("date") ?? undefined;
  try {
    const slate = await buildSlate(date);
    return NextResponse.json(slate);
  } catch (err) {
    return NextResponse.json(
      { date: date ?? "", games: [], generatedAt: Date.now(), error: err instanceof Error ? err.message : "slate_failed" },
      { status: 502 },
    );
  }
}
