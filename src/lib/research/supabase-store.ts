/* ============================================================================
   Supabase-backed ContextEvent store. Implements the SAME ContextEventStore
   interface as the in-memory baseline so nothing downstream changes. Each capture
   is an APPEND-ONLY row in `context_events` (a DB trigger blocks UPDATE/DELETE);
   reads collapse to the latest capture per `event_key` so listForPlayer/Game show
   the current view while the full point-in-time history is preserved. Server-only.
   ========================================================================== */

import { getServiceClient } from "@/lib/supabase/server";
import type { Json } from "@/lib/supabase/database.types";
import type { ContextEvent, ContextEventType, ContextEventStatus, ContextEventSeverity } from "./types";
import type { ContextEventStore } from "./store";

interface Row {
  event_key: string;
  player_id: number;
  game_pk: number | null;
  type: string;
  status: string;
  severity: string;
  confidence: number;
  summary: string;
  source_type: string;
  mentions: number;
  unique_threads: number;
  subreddits: string[];
  first_seen_at: string | null;
  last_seen_at: string | null;
  credibility_level: string | null;
  credibility_reasons: string[];
  verification_note: string | null;
  sources: Json;
  fetched_at: string;
  captured_at: string;
}

function rowToEvent(r: Row): ContextEvent {
  return {
    id: r.event_key,
    playerId: Number(r.player_id),
    gamePk: r.game_pk ?? undefined,
    type: r.type as ContextEventType,
    summary: r.summary,
    status: r.status as ContextEventStatus,
    confidence: Number(r.confidence),
    severity: r.severity as ContextEventSeverity,
    sourceType: "reddit",
    reddit: {
      mentions: r.mentions,
      subreddits: r.subreddits ?? [],
      firstSeenAt: r.first_seen_at ? Date.parse(r.first_seen_at) : 0,
      lastSeenAt: r.last_seen_at ? Date.parse(r.last_seen_at) : 0,
      uniqueThreads: r.unique_threads,
    },
    credibility: { level: (r.credibility_level as "low" | "medium" | "high") ?? "low", reasons: r.credibility_reasons ?? [] },
    sources: Array.isArray(r.sources) ? (r.sources as unknown as ContextEvent["sources"]) : [],
    verificationNote: r.verification_note ?? undefined,
    fetchedAt: Date.parse(r.fetched_at),
  };
}

/** Collapse append-only rows to the latest capture per event_key. */
function latestPerKey(rows: Row[]): ContextEvent[] {
  const byKey = new Map<string, Row>();
  for (const r of rows) {
    const prev = byKey.get(r.event_key);
    if (!prev || Date.parse(r.captured_at) > Date.parse(prev.captured_at)) byKey.set(r.event_key, r);
  }
  return [...byKey.values()].map(rowToEvent).sort((a, b) => b.reddit.lastSeenAt - a.reddit.lastSeenAt);
}

const SELECT =
  "event_key, player_id, game_pk, type, status, severity, confidence, summary, source_type, mentions, unique_threads, subreddits, first_seen_at, last_seen_at, credibility_level, credibility_reasons, verification_note, sources, fetched_at, captured_at";

export class SupabaseContextEventStore implements ContextEventStore {
  async create(event: ContextEvent): Promise<void> {
    const client = getServiceClient();
    if (!client) return; // keyless fallback — nothing durable to write
    // Append-only: every capture inserts a NEW row (never an update).
    const { error } = await client.from("context_events").insert({
      event_key: event.id,
      player_id: event.playerId,
      game_pk: event.gamePk ?? null,
      type: event.type,
      status: event.status,
      severity: event.severity,
      confidence: event.confidence,
      summary: event.summary,
      source_type: event.sourceType,
      mentions: event.reddit.mentions,
      unique_threads: event.reddit.uniqueThreads,
      subreddits: event.reddit.subreddits,
      first_seen_at: new Date(event.reddit.firstSeenAt).toISOString(),
      last_seen_at: new Date(event.reddit.lastSeenAt).toISOString(),
      credibility_level: event.credibility.level,
      credibility_reasons: event.credibility.reasons,
      verification_note: event.verificationNote ?? null,
      sources: event.sources as unknown as Json,
      fetched_at: new Date(event.fetchedAt).toISOString(),
    });
    if (error) throw new Error(`context_events insert failed: ${error.message}`);
  }

  async listForPlayer(playerId: number): Promise<ContextEvent[]> {
    const client = getServiceClient();
    if (!client) return [];
    const { data, error } = await client.from("context_events").select(SELECT).eq("player_id", playerId).order("captured_at", { ascending: false }).limit(500);
    if (error) throw new Error(`context_events read failed: ${error.message}`);
    return latestPerKey((data ?? []) as Row[]);
  }

  async listForGame(gamePk: number): Promise<ContextEvent[]> {
    const client = getServiceClient();
    if (!client) return [];
    const { data, error } = await client.from("context_events").select(SELECT).eq("game_pk", gamePk).order("captured_at", { ascending: false }).limit(500);
    if (error) throw new Error(`context_events read failed: ${error.message}`);
    return latestPerKey((data ?? []) as Row[]);
  }
}
