import { NextResponse, type NextRequest } from "next/server";
import { z } from "zod";
import { getConversationStore } from "@/features/chat/server/conversation-store";
import { getOrCreateSessionId } from "@/features/chat/server/session";
import { chatSportSchema } from "@/features/chat/schemas/request";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const saveSchema = z.object({
  label: z.string().trim().min(1).max(80),
  question: z.string().trim().min(1).max(2000),
  sport: chatSportSchema.default("mlb"),
});

/** GET /api/chat/saved — list saved questions for the session. */
export async function GET() {
  const sessionId = await getOrCreateSessionId();
  const saved = await getConversationStore().listSavedQueries(sessionId);
  return NextResponse.json({ saved });
}

/** POST /api/chat/saved — save a reusable question. */
export async function POST(req: NextRequest) {
  const sessionId = await getOrCreateSessionId();
  const parsed = saveSchema.safeParse(await req.json().catch(() => null));
  if (!parsed.success) return NextResponse.json({ error: "invalid_request" }, { status: 400 });
  const q = await getConversationStore().saveQuery(sessionId, parsed.data.label, parsed.data.question, parsed.data.sport);
  return NextResponse.json({ saved: q });
}

/** DELETE /api/chat/saved?id= — remove a saved question. */
export async function DELETE(req: NextRequest) {
  const sessionId = await getOrCreateSessionId();
  const id = req.nextUrl.searchParams.get("id");
  if (!id) return NextResponse.json({ error: "missing_id" }, { status: 400 });
  await getConversationStore().deleteSavedQuery(sessionId, id);
  return NextResponse.json({ ok: true });
}
