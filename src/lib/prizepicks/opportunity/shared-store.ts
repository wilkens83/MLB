/* ============================================================================
   Process-shared opportunity source. The opportunity workflow persists
   assessments here; the chat reads the CURRENT (latest per line) assessments to
   answer "which lines are strongest?". A swappable source keeps it testable and
   lets a Supabase-backed store drop in later without touching callers.
   ========================================================================== */

import type { CanonicalOpportunityAssessment } from "./types";
import { InMemoryOpportunityStore, type OpportunityStore } from "./store";

let sharedStore: InMemoryOpportunityStore | null = null;
export function getSharedOpportunityStore(): OpportunityStore {
  return (sharedStore ??= new InMemoryOpportunityStore());
}

/** Provider of the current assessments the chat ranks. Overridable in tests. */
export type OpportunitySource = () => Promise<CanonicalOpportunityAssessment[]>;

const defaultSource: OpportunitySource = async () => {
  // No queryable index on the in-memory store beyond history-by-line; with no
  // persisted assessments (keyless dev) this is correctly empty.
  return [];
};

let source: OpportunitySource = defaultSource;

/** The current assessments the chat should rank. */
export async function listCurrentOpportunities(): Promise<CanonicalOpportunityAssessment[]> {
  return source();
}

/** Test seam: inject the assessments the chat will see. */
export function __setOpportunitySource(fn: OpportunitySource): void {
  source = fn;
}
export function __resetOpportunitySource(): void {
  source = defaultSource;
  sharedStore = null;
}
