"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { Diamond, Circle, type LucideIcon } from "lucide-react";
import { enabledSports } from "@/lib/sports/all";
import { sportFromPathname } from "@/lib/sports/nav";
import { cn } from "@/lib/utils";

const ICONS: Record<string, LucideIcon> = { Diamond, Circle };

/**
 * Top-bar sport tabs — a highly-visible MLB / Tennis switcher in the navbar.
 * Complements the sidebar switcher; both derive the active sport from the
 * pathname (route state is authoritative) and navigate to each sport's base path.
 */
export function SportTabs() {
  const pathname = usePathname();
  const activeKey = sportFromPathname(pathname);
  const sports = enabledSports();

  return (
    <nav aria-label="Sport" className="flex items-center gap-1 rounded-xl border border-border bg-surface p-1">
      {sports.map((s) => {
        const Icon = ICONS[s.icon] ?? Circle;
        const active = s.key === activeKey;
        return (
          <Link
            key={s.key}
            href={s.basePath}
            aria-current={active ? "page" : undefined}
            className={cn(
              "flex items-center gap-1.5 rounded-lg px-3 py-1.5 text-sm font-semibold transition-colors",
              active
                ? "bg-brand-500/12 text-brand-500"
                : "text-muted hover:bg-surface-2 hover:text-foreground",
            )}
          >
            <Icon className="h-4 w-4" strokeWidth={2.5} />
            <span className="hidden sm:inline">{s.label}</span>
          </Link>
        );
      })}
    </nav>
  );
}
