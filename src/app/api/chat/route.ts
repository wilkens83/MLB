import { NextResponse, type NextRequest } from "next/server";
import { randomUUID } from "node:crypto";
import { chatRequestSchema } from "@/features/chat/schemas/request";
import { runChat, checkRateLimit } from "@/features/chat/server/orchestrator";
import { getConversationStore } from "@/features/chat/server/conversation-store";
import { getOrCreateSessionId } from "@/features/chat/server/session";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/** POST /api/chat — ask a question; returns a validated structured response. */
export async function POST(req: NextRequest) {
  const requestId = randomUUID();
  let body: unknown;
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: "invalid_json" }, { status: 400 });
  }

  const parsed = chatRequestSchema.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json(
      { error: "invalid_request", issues: parsed.error.issues.map((i) => ({ path: i.path, message: i.message })) },
      { status: 400 },
    );
  }

  const sessionId = await getOrCreateSessionId();
  if (!checkRateLimit(sessionId)) {
    return NextResponse.json({ error: "rate_limited", message: "Too many requests — slow down a moment." }, { status: 429 });
  }

  try {
    const result = await runChat(parsed.data, sessionId, { requestId });
    return NextResponse.json(result);
  } catch {
    // Never leak stack traces / internals to the client.
    return NextResponse.json({ error: "chat_failed", requestId }, { status: 500 });
  }
}

/** GET /api/chat — list conversations, or ?conversationId= to fetch its messages. */
export async function GET(req: NextRequest) {
  const sessionId = await getOrCreateSessionId();
  const store = getConversationStore();
  const conversationId = req.nextUrl.searchParams.get("conversationId");
  if (conversationId) {
    const messages = await store.getMessages(sessionId, conversationId);
    return NextResponse.json({ conversationId, messages });
  }
  const conversations = await store.listConversations(sessionId);
  return NextResponse.json({ conversations });
}
