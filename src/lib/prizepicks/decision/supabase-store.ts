/* ============================================================================
   Supabase-backed decision store. Implements the SAME DecisionStore interface
   as the in-memory baseline (store.ts) so nothing downstream changes. Decisions
   land in the append-only `decision_snapshots` table; grading is appended to
   `grading_history` (never mutating the decision), matching the scientific
   contract. Server-only (uses the service-role client).
   ========================================================================== */

import { randomUUID } from "node:crypto";
import type { DecisionResult } from "./types";
import { configChecksum } from "./version";
import type { DecisionRecord, DecisionStore } from "./store";
import { getServiceClient } from "@/lib/supabase/server";
import type { Json } from "@/lib/supabase/database.types";

function rowToRecord(row: {
  id: string;
  subject_key: string;
  content_hash: string;
  result: unknown;
  generated_at: string;
}): DecisionRecord {
  return {
    id: row.id,
    subjectKey: row.subject_key,
    contentHash: row.content_hash,
    result: row.result as DecisionResult,
    createdAt: row.generated_at,
  };
}

export class SupabaseDecisionStore implements DecisionStore {
  async record(subjectKey: string, result: DecisionResult): Promise<DecisionRecord> {
    const client = getServiceClient();
    const frozen = structuredClone(result);
    const contentHash = configChecksum(frozen);
    const id = randomUUID();
    const createdAt = new Date().toISOString();
    if (!client) {
      // Keyless fallback — behave like the in-memory store for a single record.
      return { id, subjectKey, contentHash, result: Object.freeze(frozen), createdAt };
    }
    const { error } = await client.from("decision_snapshots").insert({
      id,
      subject_type: frozen.subjectType,
      subject_key: subjectKey,
      entry_id: frozen.subjectType === "ENTRY" ? subjectKey : null,
      decision: frozen.decision,
      policy_id: frozen.decisionPolicyId,
      policy_version: frozen.decisionPolicyVersion,
      model_version: frozen.modelVersion,
      expected_return: frozen.entryExpectedReturn ?? null,
      expected_profit: frozen.entryExpectedProfit ?? null,
      variance: frozen.entryVariance ?? null,
      downside_probability: frozen.downsideProbability ?? null,
      reasons: frozen.reasons,
      vetoes: frozen.vetoes,
      scientific_facts: null,
      feature_cutoff: frozen.featureCutoff,
      event_start_time: frozen.eventStartTime ?? null,
      input_hash: frozen.inputHash ?? null,
      config_checksum: frozen.configChecksum,
      content_hash: contentHash,
      result: frozen as unknown as Json,
      generated_at: createdAt,
    });
    if (error) throw new Error(`decision_snapshots insert failed: ${error.message}`);
    return { id, subjectKey, contentHash, result: Object.freeze(frozen), createdAt };
  }

  async history(subjectKey: string): Promise<DecisionRecord[]> {
    const client = getServiceClient();
    if (!client) return [];
    const { data, error } = await client
      .from("decision_snapshots")
      .select("id, subject_key, content_hash, result, generated_at")
      .eq("subject_key", subjectKey)
      .order("generated_at", { ascending: true });
    if (error) throw new Error(`decision_snapshots read failed: ${error.message}`);
    return (data ?? []).map(rowToRecord);
  }

  async latest(subjectKey: string): Promise<DecisionRecord | null> {
    const h = await this.history(subjectKey);
    return h.length ? h[h.length - 1] : null;
  }

  async all(): Promise<DecisionRecord[]> {
    const client = getServiceClient();
    if (!client) return [];
    const { data, error } = await client
      .from("decision_snapshots")
      .select("id, subject_key, content_hash, result, generated_at")
      .order("generated_at", { ascending: true });
    if (error) throw new Error(`decision_snapshots read failed: ${error.message}`);
    return (data ?? []).map(rowToRecord);
  }

  async grade(
    recordId: string,
    grade: NonNullable<DecisionRecord["grade"]>,
  ): Promise<DecisionRecord | null> {
    const client = getServiceClient();
    if (!client) return null;
    // Grading is a NEW append-only row — the decision snapshot is never mutated.
    const { error } = await client.from("grading_history").insert({
      decision_snapshot_id: recordId,
      new_grade: grade.result,
      grading_rule_version: "grading-1.0.0",
      graded_at: grade.gradedAt,
    });
    if (error) throw new Error(`grading_history insert failed: ${error.message}`);
    const { data } = await client
      .from("decision_snapshots")
      .select("id, subject_key, content_hash, result, generated_at")
      .eq("id", recordId)
      .maybeSingle();
    if (!data) return null;
    return { ...rowToRecord(data), grade };
  }
}
