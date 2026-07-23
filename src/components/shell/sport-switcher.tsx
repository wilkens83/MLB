"use client";

import { useEffect, useRef, useState } from "react";
import { useRouter, usePathname } from "next/navigation";
import { Diamond, Circle, Check, ChevronsUpDown, type LucideIcon } from "lucide-react";
import { enabledSports, type SportDefinition } from "@/lib/sports/all";
import { sportFromPathname } from "@/lib/sports/nav";
import { cn } from "@/lib/utils";

const ICONS: Record<string, LucideIcon> = { Diamond, Circle };

const SPORT_PREF_KEY = "diamond-edge:sport";

export function SportSwitcher({ onNavigate }: { onNavigate?: () => void }) {
  const pathname = usePathname();
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const boxRef = useRef<HTMLDivElement>(null);

  const sports = enabledSports();
  const activeKey = sportFromPathname(pathname);
  const active = sports.find((s) => s.key === activeKey) ?? sports[0];

  // Remember the last chosen sport (preference only — routes stay authoritative).
  useEffect(() => {
    try {
      window.localStorage.setItem(SPORT_PREF_KEY, activeKey);
    } catch {
      /* storage unavailable — ignore */
    }
  }, [activeKey]);

  useEffect(() => {
    function onClick(e: MouseEvent) {
      if (boxRef.current && !boxRef.current.contains(e.target as Node)) setOpen(false);
    }
    document.addEventListener("mousedown", onClick);
    return () => document.removeEventListener("mousedown", onClick);
  }, []);

  function select(s: SportDefinition) {
    setOpen(false);
    if (s.key !== activeKey) {
      router.push(s.basePath);
      onNavigate?.();
    }
  }

  const ActiveIcon = ICONS[active.icon] ?? Circle;

  return (
    <div ref={boxRef} className="relative">
      <button
        type="button"
        onClick={() => setOpen((o) => !o)}
        aria-haspopup="listbox"
        aria-expanded={open}
        className="flex w-full items-center gap-2 rounded-md border border-border bg-surface px-2.5 py-1.5 text-left text-[11px] font-medium text-muted transition-colors hover:border-brand-500/40 hover:text-foreground"
      >
        <span className="grid h-5 w-5 place-items-center rounded bg-brand-500/12 text-brand-500">
          <ActiveIcon className="h-3.5 w-3.5" strokeWidth={2.5} />
        </span>
        <span className="flex-1 truncate text-[12px] font-semibold text-foreground">{active.label}</span>
        <span className="text-[10px] uppercase tracking-wider text-muted-2">Sport</span>
        <ChevronsUpDown className="h-3.5 w-3.5 shrink-0 text-muted-2" />
      </button>

      {open && (
        <div
          role="listbox"
          className="glass-strong absolute left-0 top-full z-50 mt-1.5 w-full overflow-hidden rounded-lg border border-border shadow-xl"
        >
          {sports.map((s) => {
            const Icon = ICONS[s.icon] ?? Circle;
            const isActive = s.key === activeKey;
            return (
              <button
                key={s.key}
                type="button"
                role="option"
                aria-selected={isActive}
                onClick={() => select(s)}
                className={cn(
                  "flex w-full items-center gap-2.5 px-2.5 py-2 text-left transition-colors",
                  isActive ? "bg-brand-500/10" : "hover:bg-surface-2",
                )}
              >
                <span className="grid h-6 w-6 place-items-center rounded bg-surface-2 text-brand-500">
                  <Icon className="h-3.5 w-3.5" strokeWidth={2.5} />
                </span>
                <span className="min-w-0 flex-1">
                  <span className="block text-[13px] font-semibold text-foreground">{s.label}</span>
                  <span className="block truncate text-[11px] text-muted">{s.tagline}</span>
                </span>
                {isActive && <Check className="h-4 w-4 shrink-0 text-brand-500" />}
              </button>
            );
          })}
        </div>
      )}
    </div>
  );
}
