"use client";

import { useRef, useState, type KeyboardEvent } from "react";
import { ArrowUp, Square, RotateCcw, CalendarDays } from "lucide-react";
import { cn } from "@/lib/utils";

export function ChatComposer({
  onSubmit,
  onStop,
  onRetry,
  busy,
  date,
  onDateChange,
  canRetry,
}: {
  onSubmit: (message: string) => void;
  onStop: () => void;
  onRetry: () => void;
  busy: boolean;
  date: string;
  onDateChange: (d: string) => void;
  canRetry: boolean;
}) {
  const [value, setValue] = useState("");
  const taRef = useRef<HTMLTextAreaElement>(null);

  const submit = () => {
    const v = value.trim();
    if (!v || busy) return;
    onSubmit(v);
    setValue("");
    if (taRef.current) taRef.current.style.height = "auto";
  };

  const onKey = (e: KeyboardEvent<HTMLTextAreaElement>) => {
    if (e.key === "Enter" && !e.shiftKey) {
      e.preventDefault();
      submit();
    }
  };

  return (
    <div className="border-t border-border bg-[var(--background-elevated)] p-3">
      <div className="mb-2 flex items-center gap-2 text-[11px] text-muted">
        <CalendarDays className="h-3.5 w-3.5" />
        <input
          type="date"
          value={date}
          onChange={(e) => onDateChange(e.target.value)}
          className="rounded-md border border-border bg-surface px-1.5 py-0.5 text-[11px] outline-none"
          aria-label="Slate date"
        />
        <span className="text-muted-2">Answers are scoped to this date.</span>
        {canRetry && !busy && (
          <button onClick={onRetry} className="ml-auto inline-flex items-center gap-1 rounded-md border border-border px-2 py-0.5 hover:bg-surface-hover">
            <RotateCcw className="h-3 w-3" /> Retry
          </button>
        )}
      </div>
      <div className="flex items-end gap-2 rounded-2xl border border-border bg-surface px-3 py-2 focus-within:border-brand-500/50">
        <textarea
          ref={taRef}
          value={value}
          onChange={(e) => {
            setValue(e.target.value);
            e.target.style.height = "auto";
            e.target.style.height = `${Math.min(e.target.scrollHeight, 160)}px`;
          }}
          onKeyDown={onKey}
          rows={1}
          placeholder="Ask about today's slate, projections, PrizePicks edges, or data health…"
          className="max-h-40 flex-1 resize-none bg-transparent text-sm outline-none placeholder:text-muted-2"
        />
        {busy ? (
          <button onClick={onStop} className="grid h-9 w-9 shrink-0 place-items-center rounded-xl bg-surface-2 text-foreground hover:bg-surface-hover" aria-label="Stop generating">
            <Square className="h-4 w-4" />
          </button>
        ) : (
          <button
            onClick={submit}
            disabled={!value.trim()}
            className={cn(
              "grid h-9 w-9 shrink-0 place-items-center rounded-xl transition-colors",
              value.trim() ? "bg-brand-500 text-white hover:bg-brand-600" : "bg-surface-2 text-muted-2",
            )}
            aria-label="Send message"
          >
            <ArrowUp className="h-4 w-4" />
          </button>
        )}
      </div>
      <div className="mt-1 px-1 text-[10px] text-muted-2">
        Enter to send · Shift+Enter for a new line. Answers come only from Diamond Edge tools — no fabricated data.
      </div>
    </div>
  );
}
