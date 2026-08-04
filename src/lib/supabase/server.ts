/* ============================================================================
   Server-only Supabase clients. The service-role client bypasses RLS and is the
   ONLY path allowed to write scientific records (feature/projection/decision/
   result/metric/registry/drift/breaker). It must never be imported into a client
   component — a runtime guard enforces that, in addition to the env split.
   ========================================================================== */

import { createClient, type SupabaseClient } from "@supabase/supabase-js";
import type { Database } from "./database.types";
import { SUPABASE_URL, SUPABASE_ANON_KEY, isServiceRoleConfigured } from "./env";

function assertServer(): void {
  if (typeof window !== "undefined") {
    throw new Error("supabase/server must never run in the browser (it can hold the service-role key).");
  }
}

let servicePool: SupabaseClient<Database> | null = null;

/**
 * Trusted server client (service role, BYPASSRLS). Returns null when no
 * service-role key is configured, so callers fall back to in-memory stores in
 * tests / keyless local dev instead of throwing.
 */
export function getServiceClient(): SupabaseClient<Database> | null {
  assertServer();
  if (!isServiceRoleConfigured()) return null;
  if (!servicePool) {
    servicePool = createClient<Database>(SUPABASE_URL, process.env.SUPABASE_SERVICE_ROLE_KEY!, {
      auth: { persistSession: false, autoRefreshToken: false },
      global: { headers: { "x-diamond-edge": "server" } },
    });
  }
  return servicePool;
}

/**
 * Anonymous server client (respects RLS). Used for read paths that should behave
 * like an authenticated/anon caller — e.g. verifying RLS in tests.
 */
export function getAnonServerClient(): SupabaseClient<Database> | null {
  assertServer();
  if (SUPABASE_URL.length === 0 || SUPABASE_ANON_KEY.length === 0) return null;
  return createClient<Database>(SUPABASE_URL, SUPABASE_ANON_KEY, {
    auth: { persistSession: false, autoRefreshToken: false },
  });
}
