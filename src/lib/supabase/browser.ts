/* ============================================================================
   Browser Supabase client (anon / publishable key only — never the service
   role). Safe to import from client components. Returns null when unconfigured
   so the UI can degrade to local state.
   ========================================================================== */

"use client";

import { createClient, type SupabaseClient } from "@supabase/supabase-js";
import type { Database } from "./database.types";
import { SUPABASE_URL, SUPABASE_ANON_KEY, isSupabaseConfigured } from "./env";

let client: SupabaseClient<Database> | null = null;

export function getBrowserClient(): SupabaseClient<Database> | null {
  if (!isSupabaseConfigured()) return null;
  if (!client) client = createClient<Database>(SUPABASE_URL, SUPABASE_ANON_KEY);
  return client;
}
