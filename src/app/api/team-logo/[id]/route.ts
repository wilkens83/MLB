/* ============================================================================
   Team-logo image passthrough (presentation only). Streams the public MLB team
   logo from the same origin. No analytics, no data shape — pure image proxy.
   ========================================================================== */

import { type NextRequest } from "next/server";

export const runtime = "nodejs";
export const revalidate = 604800;

export async function GET(_req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const teamId = Number(id);
  if (!Number.isFinite(teamId)) return new Response("bad id", { status: 400 });

  const url = `https://www.mlbstatic.com/team-logos/${teamId}.svg`;
  try {
    const res = await fetch(url, { headers: { Accept: "image/*" } });
    if (!res.ok) return new Response("not found", { status: res.status });
    const buf = await res.arrayBuffer();
    return new Response(buf, {
      status: 200,
      headers: {
        "Content-Type": res.headers.get("content-type") ?? "image/svg+xml",
        "Cache-Control": "public, max-age=604800, s-maxage=604800, stale-while-revalidate=2592000",
      },
    });
  } catch {
    return new Response("upstream error", { status: 502 });
  }
}
