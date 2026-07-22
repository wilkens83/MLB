/* ============================================================================
   Board persistence (client, localStorage baseline). Append-only line snapshots
   and immutable pregame snapshots. A server DB can replace this behind the same
   function surface (see method-comparison.md). Entries are keyed by board date.
   ========================================================================== */

"use client";

import type { PrizePicksBoardEntry, PregameSnapshot } from "./types";

const KEY = (date: string) => `dp-prizepicks-board-${date}`;
const SNAP_KEY = "dp-prizepicks-pregame-snapshots";

function read<T>(key: string, fallback: T): T {
  if (typeof window === "undefined") return fallback;
  try {
    const raw = localStorage.getItem(key);
    return raw ? (JSON.parse(raw) as T) : fallback;
  } catch {
    return fallback;
  }
}
function write(key: string, value: unknown) {
  if (typeof window === "undefined") return;
  try {
    localStorage.setItem(key, JSON.stringify(value));
  } catch {
    /* ignore quota */
  }
}

export function loadBoard(date: string): PrizePicksBoardEntry[] {
  return read<PrizePicksBoardEntry[]>(KEY(date), []);
}

export function saveBoard(date: string, entries: PrizePicksBoardEntry[]) {
  write(KEY(date), entries);
}

export function addEntries(date: string, incoming: PrizePicksBoardEntry[]): PrizePicksBoardEntry[] {
  const existing = loadBoard(date);
  const dupKey = (e: PrizePicksBoardEntry) =>
    `${e.normalizedPlayerName}|${e.marketKey}|${e.rawMarketLabel}`.toLowerCase();
  const seen = new Set(existing.map(dupKey));
  const merged = [...existing];
  for (const e of incoming) if (!seen.has(dupKey(e))) merged.push(e);
  saveBoard(date, merged);
  return merged;
}

/** Patch an entry. If the line/projectionType changes, append a snapshot. */
export function updateEntry(
  date: string,
  entryId: string,
  patch: Partial<PrizePicksBoardEntry>,
  snapshotSource?: PrizePicksBoardEntry["sourceType"],
): PrizePicksBoardEntry[] {
  const entries = loadBoard(date).map((e) => {
    if (e.id !== entryId) return e;
    const next = { ...e, ...patch };
    const lineChanged = patch.line !== undefined && patch.line !== e.line;
    const typeChanged = patch.projectionType !== undefined && patch.projectionType !== e.projectionType;
    if (lineChanged || typeChanged) {
      next.snapshots = [
        ...e.snapshots,
        {
          line: next.line,
          projectionType: next.projectionType,
          sourceType: snapshotSource ?? e.sourceType,
          capturedAt: new Date().toISOString(),
          note: "line updated",
        },
      ];
    }
    return next;
  });
  saveBoard(date, entries);
  return entries;
}

export function removeEntry(date: string, entryId: string): PrizePicksBoardEntry[] {
  const entries = loadBoard(date).filter((e) => e.id !== entryId);
  saveBoard(date, entries);
  return entries;
}

export function archiveEntry(date: string, entryId: string): PrizePicksBoardEntry[] {
  return updateEntry(date, entryId, { status: "archived" });
}

/* --------------------- Immutable pregame snapshots ------------------------ */

/** Persist a pregame snapshot ONCE per (entryId, line). Never overwrites. */
export function lockPregameSnapshot(snap: PregameSnapshot): boolean {
  const all = read<PregameSnapshot[]>(SNAP_KEY, []);
  const exists = all.some((s) => s.entryId === snap.entryId && s.line === snap.line);
  if (exists) return false;
  write(SNAP_KEY, [...all, snap]);
  return true;
}

export function loadPregameSnapshots(): PregameSnapshot[] {
  return read<PregameSnapshot[]>(SNAP_KEY, []);
}
