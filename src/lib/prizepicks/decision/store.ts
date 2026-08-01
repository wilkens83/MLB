/* ============================================================================
   Immutable decision audit trail. A final decision record is never edited: if
   any input changes (line, lineup, model version, policy), a NEW record is
   appended. The store is keyed like the target DB table so a Postgres/Supabase
   adapter can replace it behind the same interface. In-memory by default.
   ========================================================================== */

import { randomUUID } from "node:crypto";
import type { DecisionResult } from "./types";
import { configChecksum } from "./version";

export interface DecisionRecord {
  id: string;
  /** Stable identity of the leg/entry this decision is about. */
  subjectKey: string;
  /** Hash of the decision result at write time — detects any post-hoc mutation. */
  contentHash: string;
  result: DecisionResult;
  createdAt: string;
  /** Grading outcome, appended later (never overwrites the decision). */
  grade?: { result: "win" | "loss" | "push" | "void"; gradedAt: string };
  corrections?: { at: string; note: string }[];
}

export interface DecisionStore {
  record(subjectKey: string, result: DecisionResult): Promise<DecisionRecord>;
  history(subjectKey: string): Promise<DecisionRecord[]>;
  latest(subjectKey: string): Promise<DecisionRecord | null>;
  all(): Promise<DecisionRecord[]>;
  grade(recordId: string, grade: NonNullable<DecisionRecord["grade"]>): Promise<DecisionRecord | null>;
}

class InMemoryDecisionStore implements DecisionStore {
  private records: DecisionRecord[] = [];

  async record(subjectKey: string, result: DecisionResult): Promise<DecisionRecord> {
    const frozen: DecisionResult = structuredClone(result);
    const rec: DecisionRecord = {
      id: randomUUID(),
      subjectKey,
      contentHash: configChecksum(frozen),
      result: Object.freeze(frozen),
      createdAt: new Date().toISOString(),
    };
    // Append-only: a changed decision is a NEW record, never an edit.
    this.records.push(rec);
    return rec;
  }

  async history(subjectKey: string): Promise<DecisionRecord[]> {
    return this.records.filter((r) => r.subjectKey === subjectKey);
  }

  async latest(subjectKey: string): Promise<DecisionRecord | null> {
    const h = await this.history(subjectKey);
    return h.length ? h[h.length - 1] : null;
  }

  async all(): Promise<DecisionRecord[]> {
    return [...this.records];
  }

  async grade(recordId: string, grade: NonNullable<DecisionRecord["grade"]>): Promise<DecisionRecord | null> {
    const rec = this.records.find((r) => r.id === recordId);
    if (!rec) return null;
    // Grading is additive; it must not mutate the immutable decision result.
    rec.grade = grade;
    return rec;
  }
}

const globalForStore = globalThis as unknown as { __diamondDecisionStore?: DecisionStore };
export function getDecisionStore(): DecisionStore {
  if (!globalForStore.__diamondDecisionStore) globalForStore.__diamondDecisionStore = new InMemoryDecisionStore();
  return globalForStore.__diamondDecisionStore;
}

/** Verify a record's stored result has not been mutated since it was written. */
export function verifyImmutable(rec: DecisionRecord): boolean {
  return configChecksum(rec.result) === rec.contentHash;
}
