/* ============================================================================
   ContextEvent store — an in-memory, size-bounded, dedup-enforcing baseline
   behind a swappable interface (a Supabase-backed store can replace it later,
   mirroring the other scientific stores). Events are keyed by their stable id so
   the same event is never stored twice.
   ========================================================================== */

import type { ContextEvent } from "./types";
import { SupabaseContextEventStore } from "./supabase-store";

export interface ContextEventStore {
  create(event: ContextEvent): Promise<void>;
  listForPlayer(playerId: number): Promise<ContextEvent[]>;
  listForGame(gamePk: number): Promise<ContextEvent[]>;
}

const MAX_EVENTS = 2000;

export class InMemoryContextEventStore implements ContextEventStore {
  private byId = new Map<string, ContextEvent>();

  async create(event: ContextEvent): Promise<void> {
    // Upsert by id — the same event is never duplicated; a newer fetch supersedes.
    this.byId.set(event.id, event);
    if (this.byId.size > MAX_EVENTS) {
      // Evict the oldest by fetchedAt.
      const oldest = [...this.byId.values()].sort((a, b) => a.fetchedAt - b.fetchedAt)[0];
      if (oldest) this.byId.delete(oldest.id);
    }
  }

  async listForPlayer(playerId: number): Promise<ContextEvent[]> {
    return [...this.byId.values()].filter((e) => e.playerId === playerId).sort((a, b) => b.reddit.lastSeenAt - a.reddit.lastSeenAt);
  }

  async listForGame(gamePk: number): Promise<ContextEvent[]> {
    return [...this.byId.values()].filter((e) => e.gamePk === gamePk).sort((a, b) => b.reddit.lastSeenAt - a.reddit.lastSeenAt);
  }

  clear(): void {
    this.byId.clear();
  }
}

let singleton: ContextEventStore | null = null;
export function getContextEventStore(): ContextEventStore {
  if (!singleton) singleton = createContextEventStore();
  return singleton;
}

function createContextEventStore(): ContextEventStore {
  // Server + service role configured → durable append-only Supabase store;
  // otherwise the in-memory baseline (tests / keyless local dev). This module is
  // server-only (the client imports only research TYPES), so the static import
  // never reaches a browser bundle.
  if (typeof window === "undefined" && (process.env.SUPABASE_SERVICE_ROLE_KEY ?? "").length > 0) {
    try {
      return new SupabaseContextEventStore();
    } catch {
      /* fall through to in-memory */
    }
  }
  return new InMemoryContextEventStore();
}
