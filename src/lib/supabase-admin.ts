import { createClient, type SupabaseClient } from "@supabase/supabase-js";
import { env } from "./env";

/**
 * Service-role client for admin operations that bypass RLS.
 * Server-side only: guarded at runtime against accidental browser use.
 */
let cachedAdminClient: SupabaseClient | null = null;

export function createAdminClient(): SupabaseClient {
  if (typeof window !== "undefined") {
    throw new Error("createAdminClient must never be called in the browser");
  }
  if (cachedAdminClient) return cachedAdminClient;

  const serviceKey = process.env.SUPABASE_SERVICE_ROLE_KEY?.trim();
  const key = serviceKey && serviceKey.length > 20 ? serviceKey : env.supabaseAnonKey;

  cachedAdminClient = createClient(env.supabaseUrl, key, {
    auth: { persistSession: false, autoRefreshToken: false },
  });
  return cachedAdminClient;
}

/** True when a real service-role key is configured (RLS bypass available). */
export function hasServiceRole(): boolean {
  const serviceKey = process.env.SUPABASE_SERVICE_ROLE_KEY?.trim();
  return Boolean(serviceKey && serviceKey.length > 20);
}
