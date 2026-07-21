/* ============================================================================
   Headshot image passthrough (presentation only). Streams the public MLB player
   headshot from the same origin so images render in every environment and can
   be cached at the edge. No analytics, no data shape — pure image proxy.
   ========================================================================== */

import { type NextRequest } from "next/server";

export const runtime = "nodejs";
export const revalidate = 86400;

const FALLBACK_SIZE = 264;

export async function GET(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const playerId = Number(id);
  if (!Number.isFinite(playerId)) return new Response("bad id", { status: 400 });

  const w = Number(req.nextUrl.searchParams.get("w")) || FALLBACK_SIZE;
  const url = `https://img.mlbstatic.com/mlb-photos/image/upload/w_${w},q_auto:best,f_auto/v1/people/${playerId}/headshot/67/current`;

  try {
    const res = await fetch(url, { headers: { Accept: "image/*" } });
    if (!res.ok) return new Response("not found", { status: res.status });
    const buf = await res.arrayBuffer();
    return new Response(buf, {
      status: 200,
      headers: {
        "Content-Type": res.headers.get("content-type") ?? "image/jpeg",
        "Cache-Control": "public, max-age=86400, s-maxage=86400, stale-while-revalidate=604800",
      },
    });
  } catch {
    return new Response("upstream error", { status: 502 });
  }
}
