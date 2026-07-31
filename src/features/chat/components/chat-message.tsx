"use client";

import { useState } from "react";
import { AlertTriangle, Download, Clock, Wrench, Sparkles, User } from "lucide-react";
import { cn } from "@/lib/utils";
import { ResponseBlock } from "./response-blocks";
import { SourceList } from "./source-list";
import { toCSV, toJSON, toMarkdown, hasTable, download } from "../lib/export";
import type { ChatAssistantResponse, ToolCallRecord } from "../schemas/response";

export interface UiMessage {
  id: string;
  role: "user" | "assistant";
  content: string;
  response?: ChatAssistantResponse;
  toolCalls?: ToolCallRecord[];
  pending?: boolean;
  createdAt: string;
}

function timeLabel(iso: string): string {
  try {
    return new Date(iso).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" });
  } catch {
    return "";
  }
}

export function ChatMessage({
  message,
  onSuggestion,
}: {
  message: UiMessage;
  onSuggestion: (q: string) => void;
}) {
  const [exportOpen, setExportOpen] = useState(false);
  const isUser = message.role === "user";
  const res = message.response;

  return (
    <div className={cn("flex gap-3", isUser && "flex-row-reverse")}>
      <div
        className={cn(
          "grid h-8 w-8 shrink-0 place-items-center rounded-lg",
          isUser ? "bg-surface-2 text-muted" : "bg-brand-500 text-white",
        )}
      >
        {isUser ? <User className="h-4 w-4" /> : <Sparkles className="h-4 w-4" />}
      </div>

      <div className={cn("min-w-0 max-w-[calc(100%-3rem)] flex-1", isUser && "flex flex-col items-end")}>
        {/* Tool status (assistant, while/after running) */}
        {!isUser && message.toolCalls && message.toolCalls.length > 0 && (
          <div className="mb-1.5 flex flex-wrap gap-1">
            {message.toolCalls.map((t, i) => (
              <span
                key={i}
                className={cn(
                  "inline-flex items-center gap-1 rounded-full border px-2 py-0.5 text-[10px]",
                  t.status === "error"
                    ? "border-[var(--negative)]/30 text-[var(--negative)]"
                    : t.status === "empty"
                      ? "border-border text-muted-2"
                      : "border-border text-muted",
                )}
              >
                <Wrench className="h-2.5 w-2.5" /> {t.label}
              </span>
            ))}
          </div>
        )}

        <div
          className={cn(
            "rounded-2xl px-3.5 py-2.5 text-sm",
            isUser ? "bg-brand-500 text-white" : "border border-border bg-[var(--background-elevated)]",
          )}
        >
          {message.pending ? (
            <ThinkingDots />
          ) : isUser ? (
            <span className="whitespace-pre-wrap">{message.content}</span>
          ) : (
            <div className="space-y-3">
              {res?.title && <div className="text-[13px] font-bold">{res.title}</div>}
              <p className="leading-relaxed text-foreground/90">{res?.answer ?? message.content}</p>

              {res?.blocks.map((b, i) => (
                <ResponseBlock key={i} block={b} />
              ))}

              {res && res.warnings.length > 0 && (
                <div className="rounded-lg border border-[var(--warning)]/30 bg-[var(--warning)]/10 p-2">
                  <div className="mb-0.5 flex items-center gap-1 text-[11px] font-semibold text-[var(--warning)]">
                    <AlertTriangle className="h-3 w-3" /> Data warnings
                  </div>
                  <ul className="space-y-0.5 pl-4 text-[11px] text-foreground/80">
                    {res.warnings.map((w, i) => (
                      <li key={i} className="list-disc">{w}</li>
                    ))}
                  </ul>
                </div>
              )}

              {res && <SourceList sources={res.sources} />}

              {/* Meta row: timestamp, freshness date, provider, export */}
              {res && (
                <div className="flex flex-wrap items-center gap-2 pt-0.5 text-[10px] text-muted-2">
                  <span className="inline-flex items-center gap-1">
                    <Clock className="h-2.5 w-2.5" /> {timeLabel(res.generatedAt)}
                  </span>
                  {res.dataAsOf && <span>· data as of {res.dataAsOf}</span>}
                  {res.meta?.developmentMode && (
                    <span className="rounded border border-[var(--warning)]/30 bg-[var(--warning)]/10 px-1 text-[var(--warning)]">
                      dev mode (mock provider)
                    </span>
                  )}
                  {res.modelVersion && <span>· {res.modelVersion}</span>}
                  <div className="relative ml-auto">
                    <button
                      onClick={() => setExportOpen((o) => !o)}
                      className="inline-flex items-center gap-1 rounded border border-border px-1.5 py-0.5 hover:bg-surface-hover"
                    >
                      <Download className="h-2.5 w-2.5" /> Export
                    </button>
                    {exportOpen && (
                      <div className="absolute right-0 z-10 mt-1 w-28 overflow-hidden rounded-lg border border-border bg-[var(--background-elevated)] shadow-lg">
                        <button className="block w-full px-3 py-1.5 text-left text-[11px] hover:bg-surface-hover" onClick={() => { download("diamond-edge-chat.json", toJSON(res), "application/json"); setExportOpen(false); }}>JSON</button>
                        <button className="block w-full px-3 py-1.5 text-left text-[11px] hover:bg-surface-hover" onClick={() => { download("diamond-edge-chat.md", toMarkdown(res), "text/markdown"); setExportOpen(false); }}>Markdown</button>
                        {hasTable(res) && (
                          <button className="block w-full px-3 py-1.5 text-left text-[11px] hover:bg-surface-hover" onClick={() => { download("diamond-edge-chat.csv", toCSV(res), "text/csv"); setExportOpen(false); }}>CSV</button>
                        )}
                      </div>
                    )}
                  </div>
                </div>
              )}
            </div>
          )}
        </div>

        {/* Suggested follow-ups */}
        {!isUser && res && res.suggestedQuestions.length > 0 && !message.pending && (
          <div className="mt-2 flex flex-wrap gap-1.5">
            {res.suggestedQuestions.slice(0, 4).map((q, i) => (
              <button
                key={i}
                onClick={() => onSuggestion(q)}
                className="rounded-full border border-border bg-surface-2/50 px-2.5 py-1 text-[11px] text-muted hover:border-brand-500/40 hover:text-foreground"
              >
                {q}
              </button>
            ))}
          </div>
        )}

        <div className={cn("mt-0.5 text-[10px] text-muted-2", isUser && "text-right")}>{timeLabel(message.createdAt)}</div>
      </div>
    </div>
  );
}

function ThinkingDots() {
  return (
    <span className="inline-flex items-center gap-1 text-muted">
      <span className="h-1.5 w-1.5 animate-bounce rounded-full bg-brand-500 [animation-delay:-0.3s]" />
      <span className="h-1.5 w-1.5 animate-bounce rounded-full bg-brand-500 [animation-delay:-0.15s]" />
      <span className="h-1.5 w-1.5 animate-bounce rounded-full bg-brand-500" />
      <span className="ml-1 text-[11px]">Analyzing…</span>
    </span>
  );
}
