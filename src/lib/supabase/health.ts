/* ============================================================================
   Scientific-persistence health. Surfaces database connectivity and per-table
   row counts for the scientific pipeline so the Data Health page can show
   whether persistence is live. Server-only. Degrades cleanly (configured:false)
   when Supabase is not set up, so keyless dev still renders.
   ========================================================================== */

import { getServiceClient } from "./server";
import { isServiceRoleConfigured, isSupabaseConfigured } from "./env";

const PIPELINE_TABLES = [
  "raw_observations",
  "prizepicks_line_snapshots",
  "payout_snapshots",
  "feature_snapshots",
  "projection_snapshots",
  "decision_snapshots",
  "official_results",
  "grading_history",
  "model_registry",
  "market_validation_metrics",
  "drift_reports",
  "circuit_breaker_events",
] as const;

export interface DatabaseHealth {
  configured: boolean;
  serviceRole: boolean;
  connected: boolean;
  error?: string;
  tables?: Record<string, number>;
}

export async function getDatabaseHealth(): Promise<DatabaseHealth> {
  const base: DatabaseHealth = {
    configured: isSupabaseConfigured(),
    serviceRole: isServiceRoleConfigured(),
    connected: false,
  };
  const client = getServiceClient();
  if (!client) return base;

  try {
    const tables: Record<string, number> = {};
    for (const t of PIPELINE_TABLES) {
      const { count, error } = await client.from(t).select("*", { count: "exact", head: true });
      if (error) throw error;
      tables[t] = count ?? 0;
    }
    return { ...base, connected: true, tables };
  } catch (e) {
    return { ...base, connected: false, error: e instanceof Error ? e.message : "unknown error" };
  }
}
