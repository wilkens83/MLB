"use client";

import { useState } from "react";
import { Plus, Search, MessageSquare, Bookmark, Trash2, Play } from "lucide-react";
import { cn } from "@/lib/utils";

export interface ConversationSummary {
  id: string;
  title: string;
  updatedAt: string;
}
export interface SavedQuerySummary {
  id: string;
  label: string;
  question: string;
}

export function ChatSidebar({
  conversations,
  activeId,
  saved,
  onNew,
  onSelect,
  onRunSaved,
  onDeleteSaved,
}: {
  conversations: ConversationSummary[];
  activeId: string | null;
  saved: SavedQuerySummary[];
  onNew: () => void;
  onSelect: (id: string) => void;
  onRunSaved: (question: string) => void;
  onDeleteSaved: (id: string) => void;
}) {
  const [q, setQ] = useState("");
  const filtered = conversations.filter((c) => c.title.toLowerCase().includes(q.toLowerCase()));

  return (
    <div className="flex h-full flex-col">
      <div className="p-2">
        <button
          onClick={onNew}
          className="flex w-full items-center gap-2 rounded-lg bg-brand-500 px-3 py-2 text-sm font-semibold text-white hover:bg-brand-600"
        >
          <Plus className="h-4 w-4" /> New chat
        </button>
      </div>

      <div className="px-2 pb-2">
        <div className="flex items-center gap-2 rounded-lg border border-border bg-surface px-2 py-1.5">
          <Search className="h-3.5 w-3.5 text-muted-2" />
          <input
            value={q}
            onChange={(e) => setQ(e.target.value)}
            placeholder="Search conversations"
            className="w-full bg-transparent text-xs outline-none placeholder:text-muted-2"
          />
        </div>
      </div>

      <div className="min-h-0 flex-1 overflow-y-auto px-2">
        {saved.length > 0 && (
          <div className="mb-3">
            <div className="px-1 pb-1 text-[10px] font-semibold uppercase tracking-wider text-muted-2">Saved questions</div>
            <ul className="space-y-0.5">
              {saved.map((s) => (
                <li key={s.id} className="group flex items-center gap-1">
                  <button
                    onClick={() => onRunSaved(s.question)}
                    className="flex min-w-0 flex-1 items-center gap-2 rounded-lg px-2 py-1.5 text-left text-xs text-muted hover:bg-surface-hover hover:text-foreground"
                    title={s.question}
                  >
                    <Bookmark className="h-3.5 w-3.5 shrink-0 text-brand-500" />
                    <span className="truncate">{s.label}</span>
                    <Play className="ml-auto hidden h-3 w-3 group-hover:block" />
                  </button>
                  <button onClick={() => onDeleteSaved(s.id)} className="hidden shrink-0 text-muted-2 hover:text-[var(--negative)] group-hover:block" aria-label="Delete saved question">
                    <Trash2 className="h-3.5 w-3.5" />
                  </button>
                </li>
              ))}
            </ul>
          </div>
        )}

        <div className="px-1 pb-1 text-[10px] font-semibold uppercase tracking-wider text-muted-2">Recent</div>
        {filtered.length === 0 ? (
          <div className="px-2 py-4 text-center text-[11px] text-muted-2">No conversations yet.</div>
        ) : (
          <ul className="space-y-0.5">
            {filtered.map((c) => (
              <li key={c.id}>
                <button
                  onClick={() => onSelect(c.id)}
                  className={cn(
                    "flex w-full items-center gap-2 rounded-lg px-2 py-1.5 text-left text-xs",
                    c.id === activeId ? "bg-surface-active text-foreground" : "text-muted hover:bg-surface-hover hover:text-foreground",
                  )}
                >
                  <MessageSquare className="h-3.5 w-3.5 shrink-0" />
                  <span className="truncate">{c.title || "Untitled"}</span>
                </button>
              </li>
            ))}
          </ul>
        )}
      </div>
    </div>
  );
}
