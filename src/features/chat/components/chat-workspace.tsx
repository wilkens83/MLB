"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { PanelLeftOpen, PanelLeftClose, Bookmark } from "lucide-react";
import { cn } from "@/lib/utils";
import { ChatSidebar, type ConversationSummary, type SavedQuerySummary } from "./chat-sidebar";
import { ChatMessage, type UiMessage } from "./chat-message";
import { ChatComposer } from "./chat-composer";
import { ChatEmptyState } from "./chat-empty-state";
import type { ChatAssistantResponse, ToolCallRecord } from "../schemas/response";
import type { PrizePicksContextEntry } from "../schemas/request";

function todayIso() {
  return new Date().toISOString().slice(0, 10);
}

/** Read the imported PrizePicks board for a date from the existing localStorage store. */
function readBoard(date: string): PrizePicksContextEntry[] {
  if (typeof window === "undefined") return [];
  try {
    const raw = localStorage.getItem(`dp-prizepicks-board-${date}`);
    if (!raw) return [];
    const rows = JSON.parse(raw) as Record<string, unknown>[];
    return rows.map((e) => ({
      playerName: String(e.rawPlayerName ?? e.normalizedPlayerName ?? ""),
      marketKey: typeof e.marketKey === "string" ? e.marketKey : undefined,
      rawMarketLabel: typeof e.rawMarketLabel === "string" ? e.rawMarketLabel : undefined,
      line: Number(e.line ?? 0),
      mlbPlayerId: typeof e.mlbPlayerId === "number" ? e.mlbPlayerId : undefined,
      projectionType: typeof e.projectionType === "string" ? e.projectionType : undefined,
      sourceType: typeof e.sourceType === "string" ? e.sourceType : undefined,
    })).filter((e) => e.playerName && Number.isFinite(e.line));
  } catch {
    return [];
  }
}

interface ChatApiResult {
  conversationId: string;
  response: ChatAssistantResponse;
  toolCalls: ToolCallRecord[];
}

export function ChatWorkspace() {
  const [messages, setMessages] = useState<UiMessage[]>([]);
  const [conversations, setConversations] = useState<ConversationSummary[]>([]);
  const [saved, setSaved] = useState<SavedQuerySummary[]>([]);
  const [conversationId, setConversationId] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [date, setDate] = useState(todayIso());
  const [sidebarOpen, setSidebarOpen] = useState(false);
  const [lastQuestion, setLastQuestion] = useState<string | null>(null);

  const abortRef = useRef<AbortController | null>(null);
  const scrollRef = useRef<HTMLDivElement>(null);
  const timezone = typeof Intl !== "undefined" ? Intl.DateTimeFormat().resolvedOptions().timeZone : "America/New_York";

  const refreshLists = useCallback(async () => {
    try {
      const [conv, sv] = await Promise.all([
        fetch("/api/chat").then((r) => r.json()),
        fetch("/api/chat/saved").then((r) => r.json()),
      ]);
      setConversations((conv.conversations ?? []).map((c: ConversationSummary) => ({ id: c.id, title: c.title, updatedAt: c.updatedAt })));
      setSaved((sv.saved ?? []).map((s: SavedQuerySummary) => ({ id: s.id, label: s.label, question: s.question })));
    } catch {
      /* non-fatal */
    }
  }, []);

  useEffect(() => {
    // Async load of conversation/saved lists; setState runs after await, not synchronously.
    // eslint-disable-next-line react-hooks/set-state-in-effect
    void refreshLists();
  }, [refreshLists]);

  useEffect(() => {
    scrollRef.current?.scrollTo({ top: scrollRef.current.scrollHeight, behavior: "smooth" });
  }, [messages]);

  const send = useCallback(
    async (message: string) => {
      if (busy) return;
      setLastQuestion(message);
      const userMsg: UiMessage = { id: `u-${Date.now()}`, role: "user", content: message, createdAt: new Date().toISOString() };
      const pendingId = `a-${Date.now()}`;
      setMessages((m) => [...m, userMsg, { id: pendingId, role: "assistant", content: "", pending: true, createdAt: new Date().toISOString() }]);
      setBusy(true);

      const controller = new AbortController();
      abortRef.current = controller;
      try {
        const res = await fetch("/api/chat", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          signal: controller.signal,
          body: JSON.stringify({
            message,
            conversationId: conversationId ?? undefined,
            sport: "mlb",
            date,
            timezone,
            prizePicksBoard: readBoard(date),
          }),
        });
        if (!res.ok) {
          const err = await res.json().catch(() => ({}));
          throw new Error(err.message || err.error || `HTTP ${res.status}`);
        }
        const data = (await res.json()) as ChatApiResult;
        setConversationId(data.conversationId);
        setMessages((m) =>
          m.map((msg) =>
            msg.id === pendingId
              ? { ...msg, pending: false, content: data.response.answer, response: data.response, toolCalls: data.toolCalls }
              : msg,
          ),
        );
        void refreshLists();
      } catch (e) {
        const aborted = e instanceof DOMException && e.name === "AbortError";
        setMessages((m) =>
          m.map((msg) =>
            msg.id === pendingId
              ? {
                  ...msg,
                  pending: false,
                  content: aborted ? "Generation stopped." : "Something went wrong. Please try again.",
                  response: {
                    answer: aborted ? "Generation stopped." : "Something went wrong. Please try again.",
                    blocks: [],
                    sources: [],
                    warnings: aborted ? [] : ["The request failed before an answer was assembled."],
                    suggestedQuestions: ["Which pitchers have the best strikeout projections today?"],
                    generatedAt: new Date().toISOString(),
                  },
                }
              : msg,
          ),
        );
      } finally {
        setBusy(false);
        abortRef.current = null;
      }
    },
    [busy, conversationId, date, timezone, refreshLists],
  );

  const stop = () => {
    abortRef.current?.abort();
  };

  const newChat = () => {
    setMessages([]);
    setConversationId(null);
    setLastQuestion(null);
    setSidebarOpen(false);
  };

  const selectConversation = async (id: string) => {
    setSidebarOpen(false);
    try {
      const data = await fetch(`/api/chat?conversationId=${id}`).then((r) => r.json());
      const loaded: UiMessage[] = (data.messages ?? []).map((m: { id: string; role: "user" | "assistant"; content: string; structured?: ChatAssistantResponse; toolCalls?: ToolCallRecord[]; createdAt: string }) => ({
        id: m.id,
        role: m.role,
        content: m.content,
        response: m.structured,
        toolCalls: m.toolCalls,
        createdAt: m.createdAt,
      }));
      setMessages(loaded);
      setConversationId(id);
    } catch {
      /* ignore */
    }
  };

  const saveCurrent = async () => {
    if (!lastQuestion) return;
    const label = window.prompt("Save this question as:", lastQuestion.slice(0, 60));
    if (!label) return;
    await fetch("/api/chat/saved", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ label, question: lastQuestion, sport: "mlb" }),
    }).catch(() => null);
    void refreshLists();
  };

  const deleteSaved = async (id: string) => {
    await fetch(`/api/chat/saved?id=${id}`, { method: "DELETE" }).catch(() => null);
    void refreshLists();
  };

  return (
    <div className="flex h-[calc(100vh-9rem)] overflow-hidden rounded-2xl border border-border bg-[var(--background-elevated)]">
      {/* Conversation sidebar */}
      <div
        className={cn(
          "absolute inset-y-0 left-0 z-30 w-64 border-r border-border bg-[var(--background-elevated)] transition-transform md:static md:z-auto md:translate-x-0",
          sidebarOpen ? "translate-x-0" : "-translate-x-full",
        )}
      >
        <ChatSidebar
          conversations={conversations}
          activeId={conversationId}
          saved={saved}
          onNew={newChat}
          onSelect={selectConversation}
          onRunSaved={(q) => send(q)}
          onDeleteSaved={deleteSaved}
        />
      </div>
      {sidebarOpen && <div className="fixed inset-0 z-20 bg-black/40 md:hidden" onClick={() => setSidebarOpen(false)} aria-hidden />}

      {/* Main column */}
      <div className="flex min-w-0 flex-1 flex-col">
        <div className="flex items-center gap-2 border-b border-border px-3 py-2">
          <button onClick={() => setSidebarOpen((o) => !o)} className="grid h-8 w-8 place-items-center rounded-lg border border-border text-muted hover:text-foreground md:hidden" aria-label="Toggle conversations">
            {sidebarOpen ? <PanelLeftClose className="h-4 w-4" /> : <PanelLeftOpen className="h-4 w-4" />}
          </button>
          <div className="text-sm font-bold">AI Data Chat</div>
          <span className="rounded-full border border-border px-2 py-0.5 text-[10px] text-muted">MLB · {date}</span>
          {lastQuestion && (
            <button onClick={saveCurrent} className="ml-auto inline-flex items-center gap-1 rounded-lg border border-border px-2 py-1 text-[11px] text-muted hover:text-foreground">
              <Bookmark className="h-3 w-3" /> Save question
            </button>
          )}
        </div>

        <div ref={scrollRef} className="min-h-0 flex-1 overflow-y-auto p-4">
          {messages.length === 0 ? (
            <ChatEmptyState onPick={(q) => send(q)} />
          ) : (
            <div className="mx-auto max-w-3xl space-y-5">
              {messages.map((m) => (
                <ChatMessage key={m.id} message={m} onSuggestion={(q) => send(q)} />
              ))}
            </div>
          )}
        </div>

        <ChatComposer
          onSubmit={send}
          onStop={stop}
          onRetry={() => lastQuestion && send(lastQuestion)}
          busy={busy}
          date={date}
          onDateChange={setDate}
          canRetry={!!lastQuestion}
        />
      </div>
    </div>
  );
}
