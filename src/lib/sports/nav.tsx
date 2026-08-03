/* ============================================================================
   Sport-keyed UI configuration — the single source of truth for what the shell
   renders per sport: sidebar sections, hero/landing copy, and search wording.

   This is deliberately UI-only config (the analytics registry lives in
   `./registry`). It is keyed by the same `SportKey`, so the two never drift:
   adding a sport means one registry registration + one entry here.
   ========================================================================== */

import {
  Activity, CalendarDays, Microscope, LayoutGrid, Users, HeartPulse, ClipboardList,
  Boxes, History, FlaskConical, Sparkles, Gavel, type LucideIcon,
} from "lucide-react";
import type { SportKey } from "./types";

export interface NavItem {
  href: string;
  label: string;
  icon: LucideIcon;
  /** Active-state predicate against the current pathname. */
  match: (p: string) => boolean;
  /** Disabled = shown greyed out, not navigable (roadmap items). */
  disabled?: boolean;
}

export interface NavSection {
  title: string;
  items: NavItem[];
}

export interface SportUi {
  /** Landing route for the sport (also the sidebar logo target). */
  home: string;
  /** Sidebar navigation sections. */
  sections: NavSection[];
  /** Player-search placeholder. */
  searchPlaceholder: string;
}

/* ------------------------------------ MLB --------------------------------- */

const MLB_UI: SportUi = {
  home: "/",
  searchPlaceholder: "Search MLB players…",
  sections: [
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
        { href: "/chat", label: "AI Data Chat", icon: Sparkles, match: (p) => p.startsWith("/chat") },
        { href: "/decisions", label: "Decision Center", icon: Gavel, match: (p) => p.startsWith("/decisions") },
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
  ],
};

/* ----------------------------------- Tennis ------------------------------- */

const TENNIS_UI: SportUi = {
  home: "/tennis",
  searchPlaceholder: "Search Tennis players…",
  sections: [
    {
      title: "Today",
      items: [
        {
          href: "/tennis",
          label: "Dashboard",
          icon: Activity,
          match: (p) => p === "/tennis" || p === "/tennis/dashboard",
        },
        {
          href: "/tennis/matches",
          label: "Today's Matches",
          icon: CalendarDays,
          match: (p) => p === "/tennis/matches",
        },
      ],
    },
    {
      title: "Research",
      items: [
        { href: "/tennis/board", label: "PrizePicks Board", icon: ClipboardList, match: (p) => p.startsWith("/tennis/board") },
        { href: "/tennis/projections", label: "Prop Explorer", icon: Microscope, match: (p) => p.startsWith("/tennis/projections") },
        {
          href: "/tennis/matches",
          label: "Match Analysis",
          icon: LayoutGrid,
          // The list itself is "Today's Matches"; a selected match is "Match Analysis".
          match: (p) => p.startsWith("/tennis/matches/"),
        },
        { href: "/tennis/players", label: "Players", icon: Users, match: (p) => p.startsWith("/tennis/players") },
      ],
    },
    {
      title: "Tools",
      items: [
        { href: "/tennis/data-health", label: "Data Health", icon: HeartPulse, match: (p) => p.startsWith("/tennis/data-health") },
        { href: "#", label: "Entry Builder", icon: Boxes, match: () => false, disabled: true },
        { href: "#", label: "Backtesting", icon: History, match: () => false, disabled: true },
        { href: "#", label: "Model Lab", icon: FlaskConical, match: () => false, disabled: true },
      ],
    },
  ],
};

const SPORT_UI: Record<SportKey, SportUi> = {
  mlb: MLB_UI,
  tennis: TENNIS_UI,
};

/** Resolve the active sport from a pathname. Route state is authoritative. */
export function sportFromPathname(pathname: string): SportKey {
  return pathname === "/tennis" || pathname.startsWith("/tennis/") ? "tennis" : "mlb";
}

/** UI config (sidebar/search/home) for a sport. */
export function sportUi(sport: SportKey): SportUi {
  return SPORT_UI[sport];
}
