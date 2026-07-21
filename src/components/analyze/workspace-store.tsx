"use client";

import { createContext, useContext, useEffect, useState, type ReactNode } from "react";

export type Side = "over" | "under";

export interface WorkspaceEntry {
  playerId: number;
  name: string;
  isPitcher: boolean;
  market: string;
  marketLabel: string;
  line: number;
  side: Side;
  overOdds: string;
  underOdds: string;
  gamePk: number;
  teamId: number;
  teamName: string;
  opponentName: string;
}

interface WorkspaceCtx {
  entries: WorkspaceEntry[];
  add: (e: WorkspaceEntry) => void;
  remove: (playerId: number, market: string) => void;
  update: (playerId: number, market: string, patch: Partial<WorkspaceEntry>) => void;
  clear: () => void;
  has: (playerId: number, market: string) => boolean;
}

const Ctx = createContext<WorkspaceCtx | null>(null);
const STORAGE_KEY = "diamond-workspace-v1";
const MAX = 4;

export function WorkspaceProvider({ children }: { children: ReactNode }) {
  const [entries, setEntries] = useState<WorkspaceEntry[]>([]);

  useEffect(() => {
    // Hydrate from localStorage on mount. This is an external-store sync (the
    // documented use for effects); the eslint rule flags the one-shot setState.
    try {
      const raw = localStorage.getItem(STORAGE_KEY);
      // eslint-disable-next-line react-hooks/set-state-in-effect
      if (raw) setEntries(JSON.parse(raw));
    } catch {
      /* ignore corrupt storage */
    }
  }, []);

  useEffect(() => {
    try {
      localStorage.setItem(STORAGE_KEY, JSON.stringify(entries));
    } catch {
      /* ignore quota errors */
    }
  }, [entries]);

  const key = (id: number, market: string) => `${id}:${market}`;

  const add: WorkspaceCtx["add"] = (e) =>
    setEntries((prev) => {
      if (prev.some((x) => key(x.playerId, x.market) === key(e.playerId, e.market))) {
        return prev.map((x) => (key(x.playerId, x.market) === key(e.playerId, e.market) ? { ...x, side: e.side } : x));
      }
      if (prev.length >= MAX) return prev;
      return [...prev, e];
    });

  const remove: WorkspaceCtx["remove"] = (id, market) =>
    setEntries((prev) => prev.filter((x) => key(x.playerId, x.market) !== key(id, market)));

  const update: WorkspaceCtx["update"] = (id, market, patch) =>
    setEntries((prev) => prev.map((x) => (key(x.playerId, x.market) === key(id, market) ? { ...x, ...patch } : x)));

  const clear = () => setEntries([]);
  const has: WorkspaceCtx["has"] = (id, market) =>
    entries.some((x) => key(x.playerId, x.market) === key(id, market));

  return <Ctx.Provider value={{ entries, add, remove, update, clear, has }}>{children}</Ctx.Provider>;
}

export function useWorkspace() {
  const ctx = useContext(Ctx);
  if (!ctx) throw new Error("useWorkspace must be used within WorkspaceProvider");
  return ctx;
}

export { MAX as WORKSPACE_MAX };
