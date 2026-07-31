"use client";

import { Sparkles, TrendingUp, Target, ClipboardList, GitCompareArrows, HeartPulse, Flame } from "lucide-react";

const SUGGESTIONS: { icon: React.ElementType; text: string }[] = [
  { icon: TrendingUp, text: "Which pitchers have the best strikeout projections today?" },
  { icon: Flame, text: "Show the strongest home-run projections" },
  { icon: ClipboardList, text: "Which PrizePicks lines have the highest model edge?" },
  { icon: GitCompareArrows, text: "Compare Aaron Judge and Juan Soto" },
  { icon: HeartPulse, text: "What data is missing from today's slate?" },
  { icon: Target, text: "Show players with an over probability above 60%" },
];

export function ChatEmptyState({ onPick }: { onPick: (q: string) => void }) {
  return (
    <div className="mx-auto flex max-w-2xl flex-col items-center px-4 py-10 text-center">
      <div className="grid h-12 w-12 place-items-center rounded-2xl bg-brand-500 text-white">
        <Sparkles className="h-6 w-6" />
      </div>
      <h1 className="mt-4 text-xl font-black tracking-tight">AI Data Chat</h1>
      <p className="mt-1 max-w-md text-sm text-muted">
        Ask about the MLB slate, player projections, PrizePicks edges, and data health. Every number
        comes from Diamond Edge&apos;s controlled analytics tools — nothing is fabricated.
      </p>

      <div className="mt-6 grid w-full gap-2 sm:grid-cols-2">
        {SUGGESTIONS.map((s) => (
          <button
            key={s.text}
            onClick={() => onPick(s.text)}
            className="flex items-center gap-3 rounded-xl border border-border bg-surface-2/40 p-3 text-left text-sm hover:border-brand-500/40 hover:bg-surface-hover"
          >
            <s.icon className="h-4 w-4 shrink-0 text-brand-500" />
            <span>{s.text}</span>
          </button>
        ))}
      </div>
    </div>
  );
}
