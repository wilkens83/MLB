/* ============================================================================
   Conversation types shared by the store, providers, and orchestrator. Kept
   separate so both server and provider modules can import without cycles. The
   shapes mirror the intended DB tables (chat_conversations / chat_messages /
   chat_tool_calls) so a Postgres/Supabase adapter can drop in unchanged.
   ========================================================================== */

import type { ChatAssistantResponse, ToolCallRecord } from "../schemas/response";
import type { ChatSport } from "../schemas/request";

export interface PriorTurn {
  role: "user" | "assistant";
  content: string;
}

/** Structured memory carried between turns for follow-up questions. */
export interface PriorTurnState {
  kind: string;
  /** Players resolved/referenced in the last turn (for "why", "compare again"). */
  players?: { id: number; name: string }[];
  /** Last tabular rows produced (for "only show above 60%", "just lefties"). */
  rows?: Record<string, unknown>[];
  prop?: string;
  date: string;
  /** The prop line used, if a ranking/projection. */
  line?: number;
}

export interface StoredMessage {
  id: string;
  conversationId: string;
  role: "user" | "assistant";
  content: string;
  /** Validated structured response for assistant messages. */
  structured?: ChatAssistantResponse;
  toolCalls?: ToolCallRecord[];
  createdAt: string;
}

export interface StoredConversation {
  id: string;
  sessionId: string;
  title: string;
  sport: ChatSport;
  createdAt: string;
  updatedAt: string;
  /** Structured state from the last assistant turn. */
  lastState?: PriorTurnState;
}

export interface SavedQuery {
  id: string;
  sessionId: string;
  label: string;
  question: string;
  sport: ChatSport;
  createdAt: string;
}
