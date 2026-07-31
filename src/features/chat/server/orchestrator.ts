/* ============================================================================
   Chat orchestrator. Turns a validated request into a validated response:

     1. resolve date/season/context (server-side, no future leakage)
     2. build the tool allow-list + a guardrailed `invoke` (schema-validate input,
        cap tool count, per-tool timeout, row caps, structured tool-call records)
     3. load recent turns + prior state from the conversation store
     4. run the configured provider (mock by default) within a request timeout
     5. validate the assistant response; clamp table rows; persist both messages

   The model can ONLY reach data through `invoke` → the registry. No SQL, no
   arbitrary modules, no shell.
   ========================================================================== */

import { getCurrentMlbSeason } from "@/lib/mlb/season";
import { buildToolRegistry } from "../tools";
import type { ChatToolContext, ToolResult } from "../tools/types";
import { resolveDate } from "./date";
import { buildSystemPrompt } from "../prompts/system-prompt";
import { resolveProvider, ProviderNotConfiguredError } from "../llm/factory";
import { getConversationStore } from "./conversation-store";
import { CHAT_LIMITS, type ChatRequest } from "../schemas/request";
import {
  chatAssistantResponseSchema,
  type ChatAssistantResponse,
  type ToolCallRecord,
} from "../schemas/response";
import type { PriorTurnState } from "./conversation-types";

export interface OrchestratorResult {
  conversationId: string;
  response: ChatAssistantResponse;
  toolCalls: ToolCallRecord[];
}

/* ------------------------------ rate limiting ----------------------------- */

const buckets = new Map<string, number[]>();
export function checkRateLimit(sessionId: string, now = Date.now()): boolean {
  const windowStart = now - 60_000;
  const hits = (buckets.get(sessionId) ?? []).filter((t) => t > windowStart);
  if (hits.length >= CHAT_LIMITS.rateLimitPerMinute) {
    buckets.set(sessionId, hits);
    return false;
  }
  hits.push(now);
  buckets.set(sessionId, hits);
  return true;
}

/* ------------------------------ logging ----------------------------------- */

function log(requestId: string, event: string, fields: Record<string, unknown> = {}) {
  // Structured, secret-free logging.
  console.log(JSON.stringify({ scope: "chat", requestId, event, ...fields }));
}

/* --------------------------------- run ------------------------------------ */

export async function runChat(
  req: ChatRequest,
  sessionId: string,
  opts: { requestId: string; now?: Date } = { requestId: "req" },
): Promise<OrchestratorResult> {
  const now = opts.now ?? new Date();
  const timezone = req.timezone || "America/New_York";
  const resolved = resolveDate(req.message, timezone, req.date, now);
  const season = getCurrentMlbSeason(new Date(`${resolved.date}T12:00:00Z`));

  const store = getConversationStore();
  const { conversation } = await store.appendUserMessage(sessionId, req.conversationId ?? "", req.message);
  const history = await store.getRecentTurns(conversation.id, CHAT_LIMITS.maxHistoryTurns);
  const priorState: PriorTurnState | undefined = await store.getLastState(conversation.id);

  const registry = buildToolRegistry();
  const toolCalls: ToolCallRecord[] = [];
  let toolCount = 0;

  const controller = new AbortController();
  const requestTimer = setTimeout(() => controller.abort(), CHAT_LIMITS.requestTimeoutMs);

  const context: ChatToolContext = {
    date: resolved.date,
    season,
    sport: req.sport,
    timezone,
    playerId: req.context?.playerId,
    gamePk: req.context?.gamePk,
    prizePicksBoard: req.prizePicksBoard,
    signal: controller.signal,
    log: (event, fields) => log(opts.requestId, `tool:${event}`, fields),
  };

  const invoke = async <T = unknown>(toolName: string, rawInput: unknown): Promise<ToolResult<T>> => {
    const tool = registry.get(toolName);
    if (!tool) throw new Error(`Unknown tool: ${toolName}`);
    if (toolCount >= CHAT_LIMITS.maxToolsPerRequest) {
      throw new Error(`Tool budget exceeded (${CHAT_LIMITS.maxToolsPerRequest})`);
    }
    toolCount++;
    const parsed = tool.inputSchema.safeParse(rawInput ?? {});
    if (!parsed.success) {
      const rec: ToolCallRecord = {
        toolName,
        status: "error",
        durationMs: 0,
        label: `Invalid input for ${toolName}`,
      };
      toolCalls.push(rec);
      throw new Error(`Invalid input for ${toolName}: ${parsed.error.message}`);
    }
    const start = Date.now();
    try {
      const result = (await withTimeout(
        tool.execute(parsed.data, context),
        CHAT_LIMITS.toolTimeoutMs,
        controller.signal,
      )) as ToolResult<T>;
      const durationMs = Date.now() - start;
      toolCalls.push({
        toolName,
        status: (result.rowCount ?? 1) === 0 ? "empty" : "ok",
        durationMs,
        label: result.summary,
        rowCount: result.rowCount,
      });
      log(opts.requestId, "tool:done", { toolName, durationMs, rowCount: result.rowCount });
      return result;
    } catch {
      const durationMs = Date.now() - start;
      toolCalls.push({ toolName, status: "error", durationMs, label: `Failed: ${toolName}` });
      log(opts.requestId, "tool:error", { toolName, durationMs });
      // Degrade gracefully — return an empty, warning-only result.
      return {
        data: undefined as T,
        sources: [],
        warnings: [`The "${toolName}" tool failed or timed out; that data is unavailable.`],
        summary: `${toolName} failed`,
        rowCount: 0,
      };
    }
  };

  let response: ChatAssistantResponse;
  let state: PriorTurnState | undefined;
  try {
    const provider = resolveProvider();
    const systemPrompt = buildSystemPrompt({ date: resolved.date, season, timezone, sport: req.sport });
    log(opts.requestId, "provider", { provider: provider.name, model: provider.model, date: resolved.date, season });

    const result = await withTimeout(
      provider.respond({
        message: req.message,
        history,
        priorState,
        context,
        registry,
        systemPrompt,
        invoke,
        recordToolCall: (rec) => toolCalls.push(rec),
      }),
      CHAT_LIMITS.requestTimeoutMs,
      controller.signal,
    );
    response = result.response;
    state = result.state;
  } catch (err) {
    if (err instanceof ProviderNotConfiguredError) {
      response = safeError(
        resolved.date,
        season,
        `The configured AI provider isn't available: ${err.message}. Set CHAT_AI_PROVIDER=mock for offline mode.`,
      );
    } else {
      const aborted = controller.signal.aborted;
      response = safeError(
        resolved.date,
        season,
        aborted
          ? "The request timed out before an answer could be assembled. Please try again."
          : "Something went wrong assembling the answer. Please try again.",
      );
    }
    state = undefined;
  } finally {
    clearTimeout(requestTimer);
  }

  response.meta = { ...(response.meta ?? { provider: "unknown", toolsUsed: [] }), toolsUsed: toolCalls.map((t) => t.toolName) };
  response = clampAndValidate(response, resolved.date, season);

  await store.appendAssistantMessage(conversation.id, response, toolCalls, state);
  log(opts.requestId, "done", { conversationId: conversation.id, tools: toolCalls.length, warnings: response.warnings.length });

  return { conversationId: conversation.id, response, toolCalls };
}

/* ------------------------------- helpers ---------------------------------- */

function withTimeout<T>(promise: Promise<T>, ms: number, signal: AbortSignal): Promise<T> {
  return new Promise<T>((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error("timeout")), ms);
    const onAbort = () => {
      clearTimeout(timer);
      reject(new Error("aborted"));
    };
    signal.addEventListener("abort", onAbort, { once: true });
    promise.then(
      (v) => {
        clearTimeout(timer);
        signal.removeEventListener("abort", onAbort);
        resolve(v);
      },
      (e) => {
        clearTimeout(timer);
        signal.removeEventListener("abort", onAbort);
        reject(e);
      },
    );
  });
}

/** Clamp table rows to the guardrail and re-validate; on failure return a safe error. */
export function clampAndValidate(
  response: ChatAssistantResponse,
  date: string,
  season: number,
): ChatAssistantResponse {
  const clamped: ChatAssistantResponse = {
    ...response,
    blocks: response.blocks.map((b) =>
      b.type === "table" && b.rows.length > CHAT_LIMITS.maxTableRows
        ? { ...b, rows: b.rows.slice(0, CHAT_LIMITS.maxTableRows) }
        : b,
    ),
  };
  const parsed = chatAssistantResponseSchema.safeParse(clamped);
  if (parsed.success) return parsed.data;
  return safeError(date, season, "The assistant produced an invalid response and it was discarded for safety.");
}

export function safeError(date: string, season: number, message: string): ChatAssistantResponse {
  return {
    answer: message,
    blocks: [{ type: "markdown", content: message }],
    sources: [],
    warnings: [message],
    suggestedQuestions: [
      "Which pitchers have the best strikeout projections today?",
      "What data is missing today?",
    ],
    generatedAt: new Date().toISOString(),
    dataAsOf: date,
    meta: { provider: "system", toolsUsed: [] },
  };
}
