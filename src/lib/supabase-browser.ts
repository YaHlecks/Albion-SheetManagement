import { createClient, type SupabaseClient } from "@supabase/supabase-js";
import { env } from "./env";

/**
 * Anon client with localStorage session persistence — used in the browser
 * for realtime-dependent flows (notification polling, auth state changes).
 * Never holds elevated privileges.
 */
export function createBrowserClient(): SupabaseClient {
  return createClient(env.supabaseUrl, env.supabaseAnonKey, {
    auth: { persistSession: true, autoRefreshToken: true },
  });
}
