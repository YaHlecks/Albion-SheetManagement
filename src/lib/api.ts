import { redirect } from "next/navigation";
import { getSessionContext, type SessionContext } from "./auth";
import { env } from "./env";

/**
 * Server-side session guard for protected pages.
 * Route decision happens ONLY after the profile has been resolved (§4):
 * - No session                -> /login (preserving destination)
 * - Profile missing / DB error-> /pending-approval?error=profile-db (distinct
 *                               PROFILE_ERROR state — never "pending")
 * - status = pending/etc      -> /pending-approval?status=...
 * - Approved                  -> render (admin pages additionally use
 *                               requireAdminPage, which is a separate check —
 *                               an active member is NOT "pending", §12)
 */
export async function requirePageSession(): Promise<SessionContext> {
  if (!env.supabaseConfigured) {
    throw new Error(
      "Supabase is not configured. Set NEXT_PUBLIC_SUPABASE_URL and NEXT_PUBLIC_SUPABASE_ANON_KEY."
    );
  }

  const ctx = await getSessionContext();
  if (!ctx) redirect("/login");

  if (!ctx.profile) {
    // PROFILE_ERROR ≠ PENDING (§4/§5/§7): the profile row could not be loaded
    // (RLS/database failure) or does not exist. Log the decision, keep the
    // session, and surface the distinct error state — which retries the
    // guarded route, so a transient failure self-recovers.
    console.error(
      `[auth] route guard: requested=session profile=ERROR (row missing or DB failure) user=${ctx.userId}`
    );
    redirect("/pending-approval?error=profile-db");
  }

  if (!ctx.isApproved) {
    console.info(
      `[auth] route guard: requested=session profile=loaded role=${ctx.isPlatformAdmin ? "ADMIN" : "MEMBER"} status=${ctx.profile.status} authorized=false redirect=/pending-approval`
    );
    redirect(`/pending-approval?status=${encodeURIComponent(ctx.profile.status)}`);
  }

  console.info(
    `[auth] route guard: requested=session profile=loaded role=${ctx.isPlatformAdmin ? "ADMIN" : "MEMBER"} status=${ctx.profile.status} authorized=true redirect=none`
  );
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
