"use client";

import { useState, useRef, useEffect, useId } from "react";
import { useQuery } from "@tanstack/react-query";
import { Loader2 } from "lucide-react";
import { cn } from "@/lib/utils";
import { PlayerAvatar } from "@/components/player-avatar";
import {
  type AutocompletePlayer,
  type SearchRole,
  type SelectedPlayer,
  nextActiveIndex,
  toSelectedPlayer,
} from "@/lib/prizepicks/autocomplete";

function useDebounced<T>(value: T, ms: number) {
  const [v, setV] = useState(value);
  useEffect(() => {
    const t = setTimeout(() => setV(value), ms);
    return () => clearTimeout(t);
  }, [value, ms]);
  return v;
}

/**
 * Searchable MLB-player field for the PrizePicks manual-entry row. Reuses the
 * existing MLB fuzzy search (`/api/players/search`) — never a static list. Free
 * text is preserved via `onChange` (the resolver still handles a typed name);
 * picking a result reports canonical identity via `onSelect` so a later resolve
 * step never re-resolves incorrectly. `role` biases ordering only (never filters).
 */
export function PlayerAutocomplete({
  value,
  onChange,
  onSelect,
  role,
  placeholder = "Player",
  className,
}: {
  value: string;
  onChange: (text: string) => void;
  onSelect: (player: SelectedPlayer) => void;
  role?: SearchRole;
  placeholder?: string;
  className?: string;
}) {
  const [open, setOpen] = useState(false);
  const [active, setActive] = useState(0);
  const debounced = useDebounced(value, 250);
  const boxRef = useRef<HTMLDivElement>(null);
  const listboxId = useId();

  const q = debounced.trim();
  const { data, isFetching, isError } = useQuery({
    queryKey: ["pp-player-autocomplete", q, role ?? ""],
    queryFn: async () => {
      const params = new URLSearchParams({ q });
      if (role) params.set("role", role);
      const res = await fetch(`/api/players/search?${params.toString()}`);
      const json = (await res.json()) as { players?: AutocompletePlayer[]; error?: string };
      if (!res.ok || json.error) throw new Error(json.error ?? "search_failed");
      return json.players ?? [];
    },
    enabled: open && q.length >= 2,
    retry: false,
  });

  const results = data ?? [];

  useEffect(() => {
    function onClick(e: MouseEvent) {
      if (boxRef.current && !boxRef.current.contains(e.target as Node)) setOpen(false);
    }
    document.addEventListener("mousedown", onClick);
    return () => document.removeEventListener("mousedown", onClick);
  }, []);

  function pick(p: AutocompletePlayer) {
    // Report canonical identity; the parent sets the row text from playerName so
    // we do not fight the controlled `value` with a second update.
    onSelect(toSelectedPlayer(p));
    setOpen(false);
  }

  const showDropdown = open && q.length >= 2;

  return (
    <div ref={boxRef} className={cn("relative", className)}>
      <input
        value={value}
        onChange={(e) => {
          onChange(e.target.value);
          setOpen(true);
          setActive(0);
        }}
        onFocus={() => setOpen(true)}
        onKeyDown={(e) => {
          if (e.key === "ArrowDown" || e.key === "ArrowUp") {
            e.preventDefault();
            setActive((a) => nextActiveIndex(e.key, a, results.length));
          } else if (e.key === "Enter" && showDropdown && results[active]) {
            e.preventDefault();
            pick(results[active]);
          } else if (e.key === "Escape") {
            setOpen(false);
          }
        }}
        placeholder={placeholder}
        role="combobox"
        aria-expanded={showDropdown}
        aria-controls={listboxId}
        aria-autocomplete="list"
        className="h-8 w-full rounded border border-border bg-surface px-2 pr-7 text-sm outline-none"
      />
      {isFetching && (
        <Loader2 className="pointer-events-none absolute right-2 top-2 h-4 w-4 animate-spin text-muted" />
      )}

      {showDropdown && (
        <div id={listboxId} role="listbox" className="glass-strong absolute z-[60] mt-1 max-h-64 w-full overflow-y-auto rounded-lg border border-border shadow-xl">
          {isFetching && results.length === 0 && (
            <div className="px-3 py-2.5 text-xs text-muted">Searching players…</div>
          )}
          {isError && (
            <div className="px-3 py-2.5 text-xs text-[var(--negative)]">Player search unavailable</div>
          )}
          {!isFetching && !isError && results.length === 0 && (
            <div className="px-3 py-2.5 text-xs text-muted">No MLB players found</div>
          )}
          {results.map((p, i) => (
            <button
              key={p.id}
              type="button"
              role="option"
              aria-selected={i === active}
              onMouseEnter={() => setActive(i)}
              // mousedown (not click) so selection fires before the input blurs
              // and before the click-outside listener can close the dropdown.
              onMouseDown={(e) => {
                e.preventDefault();
                pick(p);
              }}
              className={cn(
                "flex w-full items-center gap-2.5 px-2.5 py-2 text-left transition-colors",
                i === active ? "bg-brand-500/12" : "hover:bg-surface-2",
              )}
            >
              <PlayerAvatar playerId={p.id} name={p.name} teamId={p.teamId} size="sm" />
              <span className="min-w-0 flex-1">
                <span className="block truncate text-sm font-medium">{p.name}</span>
                <span className="block truncate text-xs text-muted">
                  {[p.position, p.team || "Free agent"].filter(Boolean).join(" · ")}
                </span>
              </span>
            </button>
          ))}
        </div>
      )}
    </div>
  );
}
