/* ============================================================================
   Trusted server-side repositories for the scientific persistence layer. Every
   write goes through the service-role client here — never scattered across UI
   components. All writers no-op (return null) when Supabase is unconfigured so
   unit tests and keyless dev keep working against the in-memory paths.

   Point-in-time integrity: `observationsAvailableAt` only ever returns rows with
   available_at <= the requested feature cutoff, so a feature snapshot can never
   consume a fact that was not yet knowable. The pure `isAvailableForCutoff`
   guard encodes the same rule for tests without a database.
   ========================================================================== */

import type { SupabaseClient } from "@supabase/supabase-js";
import type { Database, TablesInsert } from "./database.types";
import { getServiceClient } from "./server";
import { configChecksum } from "@/lib/prizepicks/decision/version";

/** Deterministic content hash for a scientific payload (FNV-1a, pure). */
export function payloadHash(value: unknown): string {
  return configChecksum(value);
}

/** Point-in-time rule: a fact is usable for a cutoff only once it was knowable. */
export function isAvailableForCutoff(availableAt: string, featureCutoff: string): boolean {
  return Date.parse(availableAt) <= Date.parse(featureCutoff);
}

type Client = SupabaseClient<Database>;
async function insertReturningId<T extends keyof Database["public"]["Tables"]>(
  client: Client,
  table: T,
  row: TablesInsert<T>,
): Promise<string | null> {
  // @ts-expect-error — table/row are correlated but TS can't prove it across the generic
  const { data, error } = await client.from(table).insert(row).select("id").single();
  if (error) throw new Error(`${String(table)} insert failed: ${error.message}`);
  return (data as unknown as { id: string } | null)?.id ?? null;
}

/* --------------------------------- raw ------------------------------------ */
export type RawObservationInput = Omit<TablesInsert<"raw_observations">, "payload_hash"> & {
  payload_hash?: string;
};
export async function recordRawObservation(input: RawObservationInput): Promise<string | null> {
  const client = getServiceClient();
  if (!client) return null;
  return insertReturningId(client, "raw_observations", {
    ...input,
    payload_hash: input.payload_hash ?? payloadHash(input.payload),
  });
}

/** All observations for an entity that were AVAILABLE at/before the cutoff. */
export async function observationsAvailableAt(args: {
  entityType: string;
  entityId: string;
  featureCutoff: string;
}): Promise<Database["public"]["Tables"]["raw_observations"]["Row"][]> {
  const client = getServiceClient();
  if (!client) return [];
  const { data, error } = await client
    .from("raw_observations")
    .select("*")
    .eq("entity_type", args.entityType)
    .eq("entity_id", args.entityId)
    .lte("available_at", args.featureCutoff)
    .order("available_at", { ascending: true });
  if (error) throw new Error(`raw_observations read failed: ${error.message}`);
  return data ?? [];
}

/* ----------------------------- line snapshots ----------------------------- */
export type LineSnapshotInput = Omit<TablesInsert<"prizepicks_line_snapshots">, "payload_hash"> & {
  payload_hash?: string;
};
export async function recordLineSnapshot(input: LineSnapshotInput): Promise<string | null> {
  const client = getServiceClient();
  if (!client) return null;
  return insertReturningId(client, "prizepicks_line_snapshots", {
    ...input,
    payload_hash: input.payload_hash ?? payloadHash(input),
  });
}

type LineRow = Database["public"]["Tables"]["prizepicks_line_snapshots"]["Row"];

/** Idempotency lookup: an existing snapshot with the exact input (payload) hash. */
export async function findLineSnapshotByHash(payloadHashValue: string): Promise<LineRow | null> {
  const client = getServiceClient();
  if (!client) return null;
  const { data, error } = await client
    .from("prizepicks_line_snapshots")
    .select("*")
    .eq("payload_hash", payloadHashValue)
    .limit(1)
    .maybeSingle();
  if (error) throw new Error(`line_snapshots hash read failed: ${error.message}`);
  return data ?? null;
}

/** Most recent snapshot for a stable entry id (used to link a superseding line). */
export async function latestLineSnapshotForEntry(entryId: string): Promise<LineRow | null> {
  const client = getServiceClient();
  if (!client) return null;
  const { data, error } = await client
    .from("prizepicks_line_snapshots")
    .select("*")
    .eq("entry_id", entryId)
    .order("captured_at", { ascending: false })
    .limit(1)
    .maybeSingle();
  if (error) throw new Error(`line_snapshots entry read failed: ${error.message}`);
  return data ?? null;
}

/** Reload all persisted snapshots for a board date (entry_id is `date|player|market`). */
export async function listLineSnapshotsForBoard(boardDate: string): Promise<LineRow[]> {
  const client = getServiceClient();
  if (!client) return [];
  const { data, error } = await client
    .from("prizepicks_line_snapshots")
    .select("*")
    .like("entry_id", `${boardDate}|%`)
    .order("captured_at", { ascending: true });
  if (error) throw new Error(`line_snapshots board read failed: ${error.message}`);
  return data ?? [];
}

/* --------------------------- payout snapshots ----------------------------- */
export type PayoutSnapshotInput = Omit<TablesInsert<"payout_snapshots">, "payload_hash"> & {
  payload_hash?: string;
};
export async function recordPayoutSnapshot(input: PayoutSnapshotInput): Promise<string | null> {
  const client = getServiceClient();
  if (!client) return null;
  return insertReturningId(client, "payout_snapshots", {
    ...input,
    payload_hash: input.payload_hash ?? payloadHash(input.rules),
  });
}

/** Latest VERIFIED payout for a format/pick-count (drives payoutVerified). */
export async function latestVerifiedPayout(
  format: "power" | "flex",
  pickCount: number,
): Promise<Database["public"]["Tables"]["payout_snapshots"]["Row"] | null> {
  const client = getServiceClient();
  if (!client) return null;
  const { data, error } = await client
    .from("payout_snapshots")
    .select("*")
    .eq("format", format)
    .eq("pick_count", pickCount)
    .eq("is_verified", true)
    .order("captured_at", { ascending: false })
    .limit(1)
    .maybeSingle();
  if (error) throw new Error(`payout_snapshots read failed: ${error.message}`);
  return data ?? null;
}

/* --------------------------- feature snapshots ---------------------------- */
export type FeatureSnapshotInput = Omit<TablesInsert<"feature_snapshots">, "source_hash"> & {
  source_hash?: string;
};
export async function recordFeatureSnapshot(input: FeatureSnapshotInput): Promise<string | null> {
  const client = getServiceClient();
  if (!client) return null;
  return insertReturningId(client, "feature_snapshots", {
    ...input,
    source_hash: input.source_hash ?? payloadHash(input.features),
  });
}

/* -------------------------- projection snapshots -------------------------- */
export async function recordProjectionSnapshot(
  input: TablesInsert<"projection_snapshots">,
): Promise<string | null> {
  const client = getServiceClient();
  if (!client) return null;
  return insertReturningId(client, "projection_snapshots", input);
}

/* ---------------------------- official results ---------------------------- */
export type OfficialResultInput = Omit<TablesInsert<"official_results">, "payload_hash"> & {
  payload_hash?: string;
};
export async function recordOfficialResult(input: OfficialResultInput): Promise<string | null> {
  const client = getServiceClient();
  if (!client) return null;
  return insertReturningId(client, "official_results", {
    ...input,
    payload_hash: input.payload_hash ?? payloadHash(input),
  });
}

/* ---------------------------- grading history ----------------------------- */
export async function appendGrading(
  input: TablesInsert<"grading_history">,
): Promise<string | null> {
  const client = getServiceClient();
  if (!client) return null;
  return insertReturningId(client, "grading_history", input);
}

/* ----------------------------- model registry ----------------------------- */
export async function recordMetrics(
  input: TablesInsert<"market_validation_metrics">,
): Promise<string | null> {
  const client = getServiceClient();
  if (!client) return null;
  return insertReturningId(client, "market_validation_metrics", input);
}

export async function recordDriftReport(
  input: TablesInsert<"drift_reports">,
): Promise<string | null> {
  const client = getServiceClient();
  if (!client) return null;
  return insertReturningId(client, "drift_reports", input);
}

export async function recordCircuitBreakerEvent(
  input: TablesInsert<"circuit_breaker_events">,
): Promise<string | null> {
  const client = getServiceClient();
  if (!client) return null;
  return insertReturningId(client, "circuit_breaker_events", input);
}
