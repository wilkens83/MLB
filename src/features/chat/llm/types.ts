/* ============================================================================
   LLM provider abstraction. The chat is NOT hard-wired to one AI vendor. A
   provider receives the user message, prior turns, the resolved tool context,
   and a guardrailed `invoke` function, and returns a validated assistant
   response. Providers may ONLY reach data through `invoke` (the tool allow-list).
   ========================================================================== */

import type { ChatAssistantResponse, ToolCallRecord } from "../schemas/response";
import type { ToolRegistry } from "../tools/registry";
import type { ChatToolContext, ToolResult } from "../tools/types";
import type { PriorTurn, PriorTurnState } from "../server/conversation-types";

export interface ProviderInput {
  message: string;
  history: PriorTurn[];
  /** Structured state carried from the previous assistant turn (for follow-ups). */
  priorState?: PriorTurnState;
  context: ChatToolContext;
  registry: ToolRegistry;
  systemPrompt: string;
  /** Guardrailed tool invocation — validates input, enforces caps/timeout, records the call. */
  invoke: <T = unknown>(toolName: string, rawInput: unknown) => Promise<ToolResult<T>>;
  recordToolCall: (rec: ToolCallRecord) => void;
}

export interface ProviderResult {
  response: ChatAssistantResponse;
  /** Structured state to persist for the next turn's follow-up handling. */
  state?: PriorTurnState;
}

export interface ChatModelProvider {
  name: string;
  model?: string;
  /** True for the deterministic mock provider — surfaced to the UI as dev mode. */
  developmentMode?: boolean;
  respond(input: ProviderInput): Promise<ProviderResult>;
}
