/* ============================================================================
   Canonical line-snapshot store. Append-only with two guarantees the mission
   requires:
     - EXACT duplicate (same inputHash) ⇒ idempotent no-op (never a second row);
     - CHANGED line (same entryId, new inputHash) ⇒ a NEW snapshot that
       references the prior via `supersedesHash` — the prior is NEVER overwritten.

   Two implementations behind one interface (mirrors the decision store): an
   in-memory baseline (tests / keyless dev) and a Supabase-backed store used when
   `SUPABASE_SERVICE_ROLE_KEY` is set. Reads let the board reload persisted data.
   ========================================================================== */

import type { CanonicalLineSnapshot, LineVerificationStatus } from "./snapshot";
import type { ProjectionType, PrizePicksSourceType } from "../types";
import {
  recordLineSnapshot, findLineSnapshotByHash, latestLineSnapshotForEntry, listLineSnapshotsForBoard,
} from "@/lib/supabase/scientific";

export type PersistAction = "inserted" | "superseded" | "noop";

export interface PersistResult {
  action: PersistAction;
  snapshot: CanonicalLineSnapshot;
  /** DB id when persisted to Supabase; undefined for in-memory. */
  id?: string;
}

export interface LineSnapshotStore {
  persist(snapshot: CanonicalLineSnapshot): Promise<PersistResult>;
  list(boardDate: string): Promise<CanonicalLineSnapshot[]>;
}

/** In-memory, append-only baseline. Deterministic and fully unit-testable. */
export class InMemoryLineSnapshotStore implements LineSnapshotStore {
  private readonly rows: CanonicalLineSnapshot[] = [];

  async persist(snapshot: CanonicalLineSnapshot): Promise<PersistResult> {
    // Idempotency: identical input hash already stored ⇒ no-op.
    const dup = this.rows.find((r) => r.inputHash === snapshot.inputHash);
    if (dup) return { action: "noop", snapshot: dup };

    // A prior snapshot for the SAME entry with a different hash ⇒ this supersedes it.
    const priors = this.rows
      .filter((r) => r.entryId === snapshot.entryId)
      .sort((a, b) => a.capturedAt.localeCompare(b.capturedAt));
    const latest = priors[priors.length - 1];
    const stored: CanonicalLineSnapshot = latest
      ? { ...snapshot, supersedesHash: latest.inputHash }
      : { ...snapshot };

    this.rows.push(stored); // append-only — priors are never mutated/removed
    return { action: latest ? "superseded" : "inserted", snapshot: stored };
  }

  async list(boardDate: string): Promise<CanonicalLineSnapshot[]> {
    return this.rows
      .filter((r) => r.boardDate === boardDate)
      .sort((a, b) => a.capturedAt.localeCompare(b.capturedAt));
  }

  /** Test helper: every stored row (including superseded versions). */
  all(): CanonicalLineSnapshot[] {
    return [...this.rows];
  }
}

/** Supabase-backed store — used only when a service-role key is configured. */
export class SupabaseLineSnapshotStore implements LineSnapshotStore {
  async persist(snapshot: CanonicalLineSnapshot): Promise<PersistResult> {
    const existing = await findLineSnapshotByHash(snapshot.inputHash);
    if (existing) return { action: "noop", snapshot, id: existing.id };

    const latest = await latestLineSnapshotForEntry(snapshot.entryId);
    const id = await recordLineSnapshot({
      entry_id: snapshot.entryId,
      player_id: snapshot.playerId ?? null,
      player_name: snapshot.playerName,
      game_pk: snapshot.gamePk ?? null,
      game_number: snapshot.gameNumber ?? null,
      market_key: snapshot.marketKey,
      line: snapshot.line,
      projection_type: snapshot.projectionType,
      source_type: snapshot.source,
      source_reference: snapshot.sourceReference ?? null,
      captured_at: snapshot.capturedAt,
      // is_verified is the trusted boolean — true ONLY for VERIFIED (never client-set).
      is_verified: snapshot.verificationStatus === "VERIFIED",
      verification_status: snapshot.verificationStatus,
      supersedes_id: latest?.id ?? null,
      payload_hash: snapshot.inputHash,
    });
    return {
      action: latest ? "superseded" : "inserted",
      snapshot: latest ? { ...snapshot, supersedesHash: latest.payload_hash } : snapshot,
      id: id ?? undefined,
    };
  }

  async list(boardDate: string): Promise<CanonicalLineSnapshot[]> {
    const rows = await listLineSnapshotsForBoard(boardDate);
    return rows.map((r) => {
      const [date] = r.entry_id.split("|");
      return {
        entryId: r.entry_id,
        boardDate: date ?? boardDate,
        playerName: r.player_name ?? "",
        rawPlayerName: r.player_name ?? "",
        playerId: r.player_id ?? undefined,
        gamePk: r.game_pk ?? undefined,
        gameNumber: r.game_number ?? undefined,
        marketKey: r.market_key,
        rawMarketLabel: r.market_key,
        marketSupported: true,
        line: Number(r.line),
        projectionType: (r.projection_type as ProjectionType) ?? "standard",
        capturedAt: r.captured_at,
        source: r.source_type as PrizePicksSourceType,
        sourceReference: r.source_reference ?? undefined,
        verificationStatus: (r.verification_status as LineVerificationStatus) ?? "IMPORTED",
        inputHash: r.payload_hash,
      };
    });
  }
}

/** Return the Supabase store when a service key is set, else in-memory. */
export function getLineSnapshotStore(): LineSnapshotStore {
  return process.env.SUPABASE_SERVICE_ROLE_KEY
    ? new SupabaseLineSnapshotStore()
    : new InMemoryLineSnapshotStore();
}
