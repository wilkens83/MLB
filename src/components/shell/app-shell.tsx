"use client";

import { useState } from "react";
import Link from "next/link";
import { usePathname } from "next/navigation";
import { Menu, Diamond } from "lucide-react";
import { AppSidebar } from "./app-sidebar";
import { DataHealthIndicator } from "./data-health-indicator";
import { PlayerSearch } from "@/components/player-search";
import { ThemeToggle } from "@/components/theme-toggle";
import { SportTabs } from "./sport-tabs";
import { sportFromPathname, sportUi } from "@/lib/sports/nav";
import { getSport } from "@/lib/sports/all";

export function AppShell({ children }: { children: React.ReactNode }) {
  const [mobileOpen, setMobileOpen] = useState(false);
  const pathname = usePathname();
  const sport = sportFromPathname(pathname);
  const ui = sportUi(sport);
  const sportLabel = getSport(sport)?.label ?? "MLB";

  return (
    <div className="min-h-screen">
      <AppSidebar mobileOpen={mobileOpen} onClose={() => setMobileOpen(false)} />

      <div className="flex min-h-screen flex-col lg:pl-[240px]">
        {/* Top context bar */}
        <header className="glass-strong sticky top-0 z-30 flex h-16 items-center gap-3 border-b border-border px-4 sm:px-6">
          <button
            onClick={() => setMobileOpen(true)}
            className="grid h-9 w-9 place-items-center rounded-lg border border-border text-muted hover:text-foreground lg:hidden"
            aria-label="Open menu"
          >
            <Menu className="h-5 w-5" />
          </button>
          <Link href={ui.home} className="flex items-center gap-1.5 lg:hidden">
            <span className="grid h-7 w-7 place-items-center rounded-md bg-brand-500 text-white">
              <Diamond className="h-4 w-4" strokeWidth={2.5} />
            </span>
          </Link>

          {/* Global sport tabs — MLB / Tennis, always visible in the navbar. */}
          <SportTabs />

          <div className="hidden min-w-0 flex-1 sm:block sm:max-w-md">
            <PlayerSearch sport={sport} placeholder={ui.searchPlaceholder} />
          </div>

          <div className="ml-auto flex items-center gap-2">
            <DataHealthIndicator href={sport === "tennis" ? "/tennis/data-health" : "/health"} />
            <ThemeToggle />
          </div>
        </header>

        <main className="mx-auto w-full max-w-[1440px] flex-1 px-4 py-5 sm:px-6 sm:py-6">{children}</main>

        <footer className="border-t border-border px-6 py-5 text-center text-[11px] text-muted">
          Diamond Edge · {sportLabel} analytics &amp; modeling for research. Not betting advice. 21+ · Please play responsibly.
        </footer>
      </div>
    </div>
  );
}
