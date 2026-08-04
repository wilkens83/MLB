/* ============================================================================
   Supabase environment resolution. Names only live here — never values. The
   connected "mlb-edge" project is configured through these variables:

     NEXT_PUBLIC_SUPABASE_URL          public project URL
     NEXT_PUBLIC_SUPABASE_ANON_KEY     public anon / publishable key (browser-safe)
     SUPABASE_SERVICE_ROLE_KEY         SERVER-ONLY secret; never sent to a client

   When the public vars are absent the app falls back to in-memory persistence
   (unit tests / local dev without a database), so nothing here throws at import.
   ========================================================================== */

export const SUPABASE_URL = process.env.NEXT_PUBLIC_SUPABASE_URL ?? "";
export const SUPABASE_ANON_KEY = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY ?? "";

/** True when the public client can be constructed (URL + anon key present). */
export function isSupabaseConfigured(): boolean {
  return SUPABASE_URL.length > 0 && SUPABASE_ANON_KEY.length > 0;
}

/** True when trusted server writes are possible (service-role key present). */
export function isServiceRoleConfigured(): boolean {
  return SUPABASE_URL.length > 0 && (process.env.SUPABASE_SERVICE_ROLE_KEY ?? "").length > 0;
}
