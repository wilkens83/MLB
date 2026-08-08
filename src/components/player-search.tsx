"use client";

import { useState, useRef, useEffect } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useQuery } from "@tanstack/react-query";
import { Search, Loader2 } from "lucide-react";
import { cn, initials } from "@/lib/utils";
import type { SportKey } from "@/lib/sports/types";

interface PlayerHit {
  id: number;
  name: string;
  position: string;
  team: string;
}

function useDebounced<T>(value: T, ms: number) {
  const [v, setV] = useState(value);
  useEffect(() => {
    const t = setTimeout(() => setV(value), ms);
    return () => clearTimeout(t);
  }, [value, ms]);
  return v;
}

export function PlayerSearch({
  autoFocus = false,
  sport = "mlb",
  placeholder,
}: {
  autoFocus?: boolean;
  sport?: SportKey;
  placeholder?: string;
}) {
  const [q, setQ] = useState("");
  const [open, setOpen] = useState(false);
  const [active, setActive] = useState(0);
  const debounced = useDebounced(q, 220);
  const router = useRouter();
  const boxRef = useRef<HTMLDivElement>(null);

  // Tennis player search has no live provider wired in this environment. Rather
  // than hit the MLB endpoint (or fabricate results), the tennis search is a
  // clearly-labeled degraded state. MLB keeps its existing live search.
  const searchable = sport === "mlb";

  const { data, isFetching } = useQuery({
    queryKey: ["player-search", debounced],
    queryFn: async () => {
      const res = await fetch(`/api/players/search?q=${encodeURIComponent(debounced)}`);
      const json = (await res.json()) as { players: PlayerHit[] };
      return json.players ?? [];
    },
    enabled: searchable && debounced.trim().length >= 2,
  });

  const results = data ?? [];

  useEffect(() => {
    function onClick(e: MouseEvent) {
      if (boxRef.current && !boxRef.current.contains(e.target as Node)) setOpen(false);
    }
    document.addEventListener("mousedown", onClick);
    return () => document.removeEventListener("mousedown", onClick);
  }, []);

  function go(p: PlayerHit) {
    setOpen(false);
    setQ("");
    router.push(`/players/${p.id}`);
  }

  return (
    <div ref={boxRef} className="relative w-full">
      <div className="glass flex items-center gap-2 rounded-xl px-3 h-10">
        <Search className="h-4 w-4 text-muted shrink-0" />
        <input
          autoFocus={autoFocus}
          value={q}
          onChange={(e) => {
            setQ(e.target.value);
            setOpen(true);
            setActive(0);
          }}
          onFocus={() => setOpen(true)}
          onKeyDown={(e) => {
            if (e.key === "ArrowDown") setActive((a) => Math.min(a + 1, results.length - 1));
            else if (e.key === "ArrowUp") setActive((a) => Math.max(a - 1, 0));
            else if (e.key === "Enter" && results[active]) go(results[active]);
            else if (e.key === "Escape") setOpen(false);
          }}
          placeholder={placeholder ?? "Search players…"}
          className="w-full bg-transparent text-sm outline-none placeholder:text-muted-2"
        />
        {isFetching && <Loader2 className="h-4 w-4 animate-spin text-muted" />}
      </div>

      {open && debounced.trim().length >= 2 && !searchable && (
        <div className="glass-strong absolute z-50 mt-2 w-full overflow-hidden rounded-xl border border-border shadow-xl">
          <div className="px-3 py-3 text-sm text-muted">
            <span className="font-medium text-foreground">Instant search needs a paid live feed.</span>
            <span className="mt-0.5 block text-xs text-muted-2">
              Browse the free historical{" "}
              <Link href="/tennis/players" className="text-brand-500 hover:underline">player directory</Link>{" "}
              — real ATP/WTA data, never fabricated.
            </span>
          </div>
        </div>
      )}

      {open && debounced.trim().length >= 2 && searchable && (
        <div className="glass-strong absolute z-50 mt-2 w-full overflow-hidden rounded-xl border border-border shadow-xl">
          {results.length === 0 && !isFetching && (
            <div className="px-3 py-3 text-sm text-muted">No players found.</div>
          )}
          {results.map((p, i) => (
            <button
              key={p.id}
              onMouseEnter={() => setActive(i)}
              onClick={() => go(p)}
              className={cn(
                "flex w-full items-center gap-3 px-3 py-2 text-left transition-colors",
                i === active ? "bg-brand-500/12" : "hover:bg-surface-2",
              )}
            >
              <span className="grid h-8 w-8 shrink-0 place-items-center rounded-full bg-surface-2 text-xs font-bold text-muted">
                {initials(p.name)}
              </span>
              <span className="min-w-0 flex-1">
                <span className="block truncate text-sm font-medium">{p.name}</span>
                <span className="block truncate text-xs text-muted">
                  {p.position} · {p.team || "Free agent"}
                </span>
              </span>
            </button>
          ))}
        </div>
      )}
    </div>
  );
}
