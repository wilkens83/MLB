"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import {
  Diamond, Activity, CalendarDays, Microscope, LayoutGrid, Users, HeartPulse, X, ClipboardList,
} from "lucide-react";
import { cn } from "@/lib/utils";

interface NavItem {
  href: string;
  label: string;
  icon: typeof Activity;
  match: (p: string) => boolean;
}

const SECTIONS: { title: string; items: NavItem[] }[] = [
  {
    title: "Today",
    items: [
      { href: "/", label: "Dashboard", icon: Activity, match: (p) => p === "/" },
      { href: "/games", label: "Today's Games", icon: CalendarDays, match: (p) => p.startsWith("/games") },
    ],
  },
  {
    title: "Research",
    items: [
      { href: "/prizepicks-board", label: "PrizePicks Board", icon: ClipboardList, match: (p) => p.startsWith("/prizepicks-board") },
      { href: "/analyze", label: "Prop Explorer", icon: Microscope, match: (p) => p.startsWith("/analyze") },
      { href: "/slate", label: "Player Analysis", icon: LayoutGrid, match: (p) => p.startsWith("/slate") },
      { href: "/players", label: "Players", icon: Users, match: (p) => p.startsWith("/players") },
    ],
  },
  {
    title: "Tools",
    items: [{ href: "/health", label: "Data Health", icon: HeartPulse, match: (p) => p.startsWith("/health") }],
  },
];

export function AppSidebar({ mobileOpen, onClose }: { mobileOpen: boolean; onClose: () => void }) {
  const pathname = usePathname();

  return (
    <>
      {/* Mobile backdrop */}
      {mobileOpen && (
        <div className="fixed inset-0 z-40 bg-black/50 lg:hidden" onClick={onClose} aria-hidden />
      )}

      <aside
        className={cn(
          "fixed inset-y-0 left-0 z-50 w-[240px] border-r border-border bg-[var(--background-elevated)] transition-transform duration-200 lg:translate-x-0",
          mobileOpen ? "translate-x-0" : "-translate-x-full",
        )}
      >
        <div className="flex h-16 items-center gap-2 border-b border-border px-4">
          <Link href="/" className="flex items-center gap-2" onClick={onClose}>
            <span className="grid h-8 w-8 place-items-center rounded-lg bg-brand-500 text-white">
              <Diamond className="h-4.5 w-4.5" strokeWidth={2.5} />
            </span>
            <span className="text-[15px] font-black tracking-tight">
              DIAMOND<span className="text-brand-500">·EDGE</span>
            </span>
          </Link>
          <button onClick={onClose} className="ml-auto text-muted hover:text-foreground lg:hidden" aria-label="Close menu">
            <X className="h-5 w-5" />
          </button>
        </div>

        <nav className="flex flex-col gap-5 p-3">
          <div className="rounded-md border border-border bg-surface px-2.5 py-1.5 text-[11px] font-medium text-muted">
            MLB · Player Props
          </div>
          {SECTIONS.map((section) => (
            <div key={section.title}>
              <div className="px-2 pb-1.5 text-[10px] font-semibold uppercase tracking-wider text-muted-2">
                {section.title}
              </div>
              <ul className="space-y-0.5">
                {section.items.map((item) => {
                  const active = item.match(pathname);
                  return (
                    <li key={item.href}>
                      <Link
                        href={item.href}
                        onClick={onClose}
                        aria-current={active ? "page" : undefined}
                        className={cn(
                          "group relative flex items-center gap-2.5 rounded-lg px-2.5 py-2 text-sm font-medium transition-colors",
                          active ? "bg-surface-active text-foreground" : "text-muted hover:bg-surface-hover hover:text-foreground",
                        )}
                      >
                        {active && <span className="absolute left-0 top-1/2 h-5 w-0.5 -translate-y-1/2 rounded-r bg-brand-500" />}
                        <item.icon className={cn("h-4 w-4", active && "text-brand-500")} />
                        {item.label}
                      </Link>
                    </li>
                  );
                })}
              </ul>
            </div>
          ))}
        </nav>
      </aside>
    </>
  );
}
