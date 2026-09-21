import { createBrowserClient as createSsrBrowserClient } from "@supabase/ssr";
import { env } from "./env";

let client: ReturnType<typeof createSsrBrowserClient> | null = null;

/**
 * Cookie-based Supabase browser client.
 *
 * CRITICAL: the session must live in cookies, not localStorage. The
 * middleware and every server component read the session from cookies, so a
 * localStorage-only client produces the "logged in but bounced back to
 * /login" first-login failure: the browser thinks it is authenticated while
 * the server never sees a session. @supabase/ssr keeps the tokens in cookies
 * that both sides share, with automatic refresh handled by the middleware.
 */
export function createBrowserClient() {
  if (!client) {
    client = createSsrBrowserClient(env.supabaseUrl, env.supabaseAnonKey);
  }
  return client;
}
