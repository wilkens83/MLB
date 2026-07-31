import { test, expect, describe } from "bun:test";
import { getConversationStore } from "./conversation-store";
import type { ChatAssistantResponse } from "../schemas/response";

function fakeResponse(answer: string): ChatAssistantResponse {
  return {
    answer,
    blocks: [],
    sources: [],
    warnings: [],
    suggestedQuestions: [],
    generatedAt: new Date().toISOString(),
  };
}

describe("in-memory conversation store", () => {
  test("appends user + assistant messages and isolates by session", async () => {
    const store = getConversationStore();
    const s1 = "sess-A";
    const { conversation } = await store.appendUserMessage(s1, "", "hello");
    await store.appendAssistantMessage(conversation.id, fakeResponse("hi"), [], { kind: "help", date: "2026-07-31" });

    const msgs = await store.getMessages(s1, conversation.id);
    expect(msgs.map((m) => m.role)).toEqual(["user", "assistant"]);

    // Another session cannot read the first's messages.
    const other = await store.getMessages("sess-B", conversation.id);
    expect(other).toHaveLength(0);
  });

  test("title is the first user message; conversation is listed", async () => {
    const store = getConversationStore();
    const { conversation } = await store.appendUserMessage("sess-title", "", "Which pitchers have the best K projections?");
    const list = await store.listConversations("sess-title");
    expect(list.find((c) => c.id === conversation.id)?.title).toMatch(/pitchers/i);
  });

  test("recent-turns window trims history", async () => {
    const store = getConversationStore();
    const { conversation } = await store.appendUserMessage("sess-trim", "", "q1");
    for (let i = 2; i <= 10; i++) await store.appendUserMessage("sess-trim", conversation.id, `q${i}`);
    const recent = await store.getRecentTurns(conversation.id, 3);
    expect(recent).toHaveLength(3);
    expect(recent[recent.length - 1].content).toBe("q10");
  });

  test("last state persists across turns for follow-ups", async () => {
    const store = getConversationStore();
    const { conversation } = await store.appendUserMessage("sess-state", "", "rank pitchers");
    await store.appendAssistantMessage(conversation.id, fakeResponse("ranked"), [], {
      kind: "pitcher-k-rankings",
      date: "2026-07-31",
      prop: "strikeouts",
    });
    const state = await store.getLastState(conversation.id);
    expect(state?.kind).toBe("pitcher-k-rankings");
  });

  test("saved queries are per-session and deletable", async () => {
    const store = getConversationStore();
    const q = await store.saveQuery("sess-saved", "Top K edges", "Which pitchers have the best strikeouts?", "mlb");
    expect((await store.listSavedQueries("sess-saved")).some((s) => s.id === q.id)).toBe(true);
    expect(await store.listSavedQueries("sess-other")).toHaveLength(0);
    await store.deleteSavedQuery("sess-saved", q.id);
    expect((await store.listSavedQueries("sess-saved")).some((s) => s.id === q.id)).toBe(false);
  });
});
