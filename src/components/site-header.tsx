"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { Diamond, Activity, Users, LineChart, HeartPulse, LayoutGrid } from "lucide-react";
import { cn } from "@/lib/utils";
import { ThemeToggle } from "./theme-toggle";
import { PlayerSearch } from "./player-search";

const NAV = [
  { href: "/", label: "Dashboard", icon: Activity },
  { href: "/slate", label: "Slate", icon: LayoutGrid },
  { href: "/games", label: "Games", icon: LineChart },
  { href: "/players", label: "Players", icon: Users },
  { href: "/health", label: "Health", icon: HeartPulse },
];

export function SiteHeader() {
  const pathname = usePathname();
  return (
    <header className="glass-strong sticky top-0 z-50 border-b border-border">
      <div className="mx-auto flex h-16 max-w-7xl items-center gap-4 px-4 sm:px-6">
        <Link href="/" className="flex items-center gap-2 shrink-0">
          <span className="relative grid h-9 w-9 place-items-center rounded-xl bg-gradient-to-br from-brand-500 to-brand-700 text-white shadow-[0_6px_20px_-6px_rgba(249,115,22,0.7)]">
            <Diamond className="h-5 w-5" strokeWidth={2.5} />
          </span>
          <span className="text-lg font-black tracking-tight">
            DIAMOND<span className="text-gradient-brand">·EDGE</span>
          </span>
        </Link>

        <nav className="ml-2 hidden items-center gap-1 md:flex">
          {NAV.map((item) => {
            const active = item.href === "/" ? pathname === "/" : pathname.startsWith(item.href);
            return (
              <Link
                key={item.href}
                href={item.href}
                className={cn(
                  "flex items-center gap-1.5 rounded-lg px-3 py-2 text-sm font-medium transition-colors",
                  active
                    ? "bg-brand-500/12 text-brand-500"
                    : "text-muted hover:bg-surface-2 hover:text-foreground",
                )}
              >
                <item.icon className="h-4 w-4" />
                {item.label}
              </Link>
            );
          })}
        </nav>

        <div className="ml-auto flex items-center gap-2">
          <div className="hidden sm:block w-56 lg:w-72">
            <PlayerSearch />
          </div>
          <ThemeToggle />
        </div>
      </div>
    </header>
  );
}
