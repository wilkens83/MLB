/* ============================================================================
   Opportunity assessment persistence. Assessments are immutable point-in-time
   records: each references the EXACT line snapshot + model/calibration/feature
   versions it was produced from, so a later re-run is a NEW record, never an
   overwrite. In-memory baseline behind an interface (a Supabase-backed store can
   replace it exactly as the decision store does).
   ========================================================================== */

import type { CanonicalOpportunityAssessment } from "./types";

export interface StoredOpportunity {
  id: string;
  assessment: CanonicalOpportunityAssessment;
  storedAt: string;
}

export interface OpportunityStore {
  persist(assessment: CanonicalOpportunityAssessment): Promise<StoredOpportunity>;
  /** All assessments for a line snapshot, oldest → newest (immutable history). */
  history(lineSnapshotId: string): Promise<StoredOpportunity[]>;
  latest(lineSnapshotId: string): Promise<StoredOpportunity | null>;
}

export class InMemoryOpportunityStore implements OpportunityStore {
  private readonly rows: StoredOpportunity[] = [];
  private seq = 0;

  async persist(assessment: CanonicalOpportunityAssessment): Promise<StoredOpportunity> {
    // Frozen deep clone — the persisted record can never be mutated in place.
    const record: StoredOpportunity = {
      id: `opp-${++this.seq}`,
      assessment: Object.freeze(structuredClone(assessment)),
      storedAt: new Date().toISOString(),
    };
    this.rows.push(record);
    return record;
  }

  async history(lineSnapshotId: string): Promise<StoredOpportunity[]> {
    return this.rows.filter((r) => r.assessment.lineSnapshotId === lineSnapshotId);
  }

  async latest(lineSnapshotId: string): Promise<StoredOpportunity | null> {
    const h = await this.history(lineSnapshotId);
    return h[h.length - 1] ?? null;
  }
}
