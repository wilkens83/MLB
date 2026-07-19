import { NextResponse } from "next/server";
import { getAllHealth } from "@/lib/providers/health";
import { mlbCacheStats } from "@/lib/mlb/client";
import { getValidationFailureCount } from "@/lib/schemas/validate";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET() {
  return NextResponse.json({
    generatedAt: Date.now(),
    cache: mlbCacheStats(),
    validationFailures: getValidationFailureCount(),
    providers: getAllHealth(),
  });
}
