/* ============================================================================
   Conversation persistence abstraction. The default implementation is an
   in-memory, server-side store keyed by an anonymous session id (cookie). It is
   intentionally shaped like the target tables (chat_conversations, chat_messages,
   chat_tool_calls, chat_saved_queries) so a Postgres/Supabase adapter can replace
   it behind the same `ConversationStore` interface without touching callers.

   Not localStorage: history/state live on the server so follow-up context and
   tool provenance are authoritative and survive across devices once auth exists.
   ========================================================================== */

import { randomUUID } from "node:crypto";
import type {
  StoredConversation,
  StoredMessage,
  PriorTurn,
  PriorTurnState,
  SavedQuery,
} from "./conversation-types";
import type { ChatAssistantResponse, ToolCallRecord } from "../schemas/response";
import type { ChatSport } from "../schemas/request";
import { CHAT_LIMITS } from "../schemas/request";

export interface AppendUserResult {
  conversation: StoredConversation;
  messageId: string;
}

export interface ConversationStore {
  createConversation(sessionId: string, sport: ChatSport, title: string): Promise<StoredConversation>;
  getConversation(sessionId: string, id: string): Promise<StoredConversation | null>;
  listConversations(sessionId: string): Promise<StoredConversation[]>;
  appendUserMessage(sessionId: string, conversationId: string, content: string): Promise<AppendUserResult>;
  appendAssistantMessage(
    conversationId: string,
    response: ChatAssistantResponse,
    toolCalls: ToolCallRecord[],
    state: PriorTurnState | undefined,
  ): Promise<StoredMessage>;
  getMessages(sessionId: string, conversationId: string): Promise<StoredMessage[]>;
  /** Recent-message window (trimmed) for provider context. */
  getRecentTurns(conversationId: string, maxTurns: number): Promise<PriorTurn[]>;
  getLastState(conversationId: string): Promise<PriorTurnState | undefined>;
  // Saved queries
  saveQuery(sessionId: string, label: string, question: string, sport: ChatSport): Promise<SavedQuery>;
  listSavedQueries(sessionId: string): Promise<SavedQuery[]>;
  deleteSavedQuery(sessionId: string, id: string): Promise<void>;
}

/* ------------------------------ in-memory --------------------------------- */

class InMemoryConversationStore implements ConversationStore {
  private conversations = new Map<string, StoredConversation>();
  private messages = new Map<string, StoredMessage[]>();
  private saved: SavedQuery[] = [];
  private readonly maxConversationsPerSession = 100;

  async createConversation(sessionId: string, sport: ChatSport, title: string): Promise<StoredConversation> {
    const now = new Date().toISOString();
    const conv: StoredConversation = {
      id: randomUUID(),
      sessionId,
      title: title.slice(0, 80),
      sport,
      createdAt: now,
      updatedAt: now,
    };
    this.conversations.set(conv.id, conv);
    this.messages.set(conv.id, []);
    this.evictOldConversations(sessionId);
    return conv;
  }

  async getConversation(sessionId: string, id: string): Promise<StoredConversation | null> {
    const c = this.conversations.get(id);
    return c && c.sessionId === sessionId ? c : null;
  }

  async listConversations(sessionId: string): Promise<StoredConversation[]> {
    return [...this.conversations.values()]
      .filter((c) => c.sessionId === sessionId)
      .sort((a, b) => b.updatedAt.localeCompare(a.updatedAt));
  }

  async appendUserMessage(sessionId: string, conversationId: string, content: string): Promise<AppendUserResult> {
    let conv = this.conversations.get(conversationId);
    if (!conv || conv.sessionId !== sessionId) {
      conv = await this.createConversation(sessionId, "mlb", content);
    }
    const msg: StoredMessage = {
      id: randomUUID(),
      conversationId: conv.id,
      role: "user",
      content,
      createdAt: new Date().toISOString(),
    };
    this.pushMessage(conv.id, msg);
    conv.updatedAt = msg.createdAt;
    if (this.messages.get(conv.id)!.filter((m) => m.role === "user").length === 1) {
      conv.title = content.slice(0, 80);
    }
    return { conversation: conv, messageId: msg.id };
  }

  async appendAssistantMessage(
    conversationId: string,
    response: ChatAssistantResponse,
    toolCalls: ToolCallRecord[],
    state: PriorTurnState | undefined,
  ): Promise<StoredMessage> {
    const msg: StoredMessage = {
      id: randomUUID(),
      conversationId,
      role: "assistant",
      content: response.answer,
      structured: response,
      toolCalls,
      createdAt: new Date().toISOString(),
    };
    this.pushMessage(conversationId, msg);
    const conv = this.conversations.get(conversationId);
    if (conv) {
      conv.updatedAt = msg.createdAt;
      conv.lastState = state;
    }
    return msg;
  }

  async getMessages(sessionId: string, conversationId: string): Promise<StoredMessage[]> {
    const conv = this.conversations.get(conversationId);
    if (!conv || conv.sessionId !== sessionId) return [];
    return this.messages.get(conversationId) ?? [];
  }

  async getRecentTurns(conversationId: string, maxTurns: number): Promise<PriorTurn[]> {
    const all = this.messages.get(conversationId) ?? [];
    return all.slice(-maxTurns).map((m) => ({ role: m.role, content: m.content }));
  }

  async getLastState(conversationId: string): Promise<PriorTurnState | undefined> {
    return this.conversations.get(conversationId)?.lastState;
  }

  async saveQuery(sessionId: string, label: string, question: string, sport: ChatSport): Promise<SavedQuery> {
    const q: SavedQuery = {
      id: randomUUID(),
      sessionId,
      label: label.slice(0, 80),
      question: question.slice(0, CHAT_LIMITS.maxMessageLength),
      sport,
      createdAt: new Date().toISOString(),
    };
    this.saved.unshift(q);
    return q;
  }

  async listSavedQueries(sessionId: string): Promise<SavedQuery[]> {
    return this.saved.filter((q) => q.sessionId === sessionId);
  }

  async deleteSavedQuery(sessionId: string, id: string): Promise<void> {
    this.saved = this.saved.filter((q) => !(q.id === id && q.sessionId === sessionId));
  }

  private pushMessage(conversationId: string, msg: StoredMessage) {
    const list = this.messages.get(conversationId) ?? [];
    list.push(msg);
    this.messages.set(conversationId, list);
  }

  private evictOldConversations(sessionId: string) {
    const mine = [...this.conversations.values()]
      .filter((c) => c.sessionId === sessionId)
      .sort((a, b) => a.updatedAt.localeCompare(b.updatedAt));
    while (mine.length > this.maxConversationsPerSession) {
      const oldest = mine.shift();
      if (!oldest) break;
      this.conversations.delete(oldest.id);
      this.messages.delete(oldest.id);
    }
  }
}

/* Singleton across hot reloads / route invocations in the Node runtime. */
const globalForStore = globalThis as unknown as { __diamondChatStore?: ConversationStore };
export function getConversationStore(): ConversationStore {
  if (!globalForStore.__diamondChatStore) {
    globalForStore.__diamondChatStore = new InMemoryConversationStore();
  }
  return globalForStore.__diamondChatStore;
}
