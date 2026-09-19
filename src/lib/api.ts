import { redirect } from "next/navigation";
import { getSessionContext, type SessionContext } from "./auth";
import { env } from "./env";

/**
 * Server-side session guard for protected pages.
 * - No session -> redirect to /login (preserving destination)
 * - Session with pending/rejected/suspended profile -> redirect to /pending-approval
 * - Approved -> return the session context
 */
export async function requirePageSession(): Promise<SessionContext> {
  if (!env.supabaseConfigured) {
    throw new Error(
      "Supabase is not configured. Set NEXT_PUBLIC_SUPABASE_URL and NEXT_PUBLIC_SUPABASE_ANON_KEY."
    );
  }

  const ctx = await getSessionContext();
  if (!ctx) redirect("/login");
  if (!ctx.isApproved) redirect("/pending-approval");
  return ctx;
}

/** Server-side admin guard for protected pages. */
export async function requireAdminPage(): Promise<SessionContext> {
  const ctx = await requirePageSession();
  if (!ctx.isPlatformAdmin) redirect("/dashboard");
  return ctx;
}

/** Safe error message for user display — never leaks database internals. */
export function publicError(err: unknown, fallback = "Something went wrong. Please try again."): string {
  if (err && typeof err === "object" && "message" in err && typeof (err as { message: unknown }).message === "string") {
    const msg = (err as { message: string }).message;
    // Whitelist known-safe messages
    const safe = [
      "Invalid login credentials",
      "Email not confirmed",
      "User already registered",
      "Password should be at least",
      "Email rate limit exceeded",
      "Signups not allowed",
    ];
    if (safe.some((s) => msg.startsWith(s))) return msg;
  }
  return fallback;
}
