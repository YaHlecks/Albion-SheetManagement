/**
 * Central environment configuration.
 *
 * Public variables are safe to expose to the browser (they only grant access
 * to data governed by Row Level Security). The service-role key is
 * server-only and must NEVER be prefixed with NEXT_PUBLIC_.
 */
const rawUrl = process.env.NEXT_PUBLIC_SUPABASE_URL ?? "";
const rawAnon = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY ?? "";

export const env = {
  supabaseUrl: rawUrl.trim(),
  supabaseAnonKey: rawAnon.trim(),
  supabaseConfigured: Boolean(rawUrl.trim() && rawAnon.trim()),
};

if (process.env.NODE_ENV === "production" && !env.supabaseConfigured) {
  console.warn(
    "[env] Supabase environment variables are not set. " +
      "Configure NEXT_PUBLIC_SUPABASE_URL and NEXT_PUBLIC_SUPABASE_ANON_KEY before deploying."
  );
}
