import { NextResponse, type NextRequest } from "next/server";
import { createServerClient } from "@supabase/ssr";
import { env } from "@/lib/env";
import { resolveCallbackOutcome } from "@/lib/auth-state";

/**
 * Single Supabase confirmation callback for BOTH email flows.
 *
 * The flows are separated by the link's `type` query parameter — set by
 * Supabase itself (`recovery` for password reset, absent/`signup` for email
 * confirmation) — not by different URLs:
 *
 *   email confirmation → exchange → /verify-email   (dedicated verification
 *                                    experience; never touches reset UI)
 *   password recovery  → exchange → /reset-password (recovery session kept)
 *
 * On exchange failure (expired / already-used / malformed link) the user is
 * sent to the FLOW-APPROPRIATE error page instead of a generic redirect:
 * verification errors go to /verify-email?status=expired|invalid and
 * recovery errors to /reset-password?error=invalid.
 */
export async function GET(request: NextRequest) {
  const sp = request.nextUrl.searchParams;
  const outcome = resolveCallbackOutcome({
    code: sp.get("code"),
    error: sp.get("error"),
    errorCode: sp.get("error_code"),
    errorDescription: sp.get("error_description"),
    type: sp.get("type"),
    next: sp.get("next"),
    supabaseConfigured: env.supabaseConfigured,
  });

  const origin = request.nextUrl.origin;
  function redirectUrl(path: string, extra?: Record<string, string>) {
    const url = new URL(path, origin);
    for (const [k, v] of Object.entries(extra ?? {})) url.searchParams.set(k, v);
    return url;
  }
  function redirectTo(path: string, extra?: Record<string, string>) {
    return NextResponse.redirect(redirectUrl(path, extra));
  }

  if (outcome.kind === "error") {
    switch (outcome.code) {
      case "config":
        return redirectTo("/login", { error: "config" });
      case "otp_expired":
      case "missing_code":
        // A recovery link that failed must stay on the recovery flow; a
        // verification link that failed must never reach the reset page.
        if (sp.get("type") === "recovery") return redirectTo("/reset-password", { error: "invalid" });
        return redirectTo("/verify-email", { status: "expired" });
      default:
        if (sp.get("type") === "recovery") return redirectTo("/reset-password", { error: "invalid" });
        return redirectTo("/verify-email", { status: "invalid" });
    }
  }

  // ---- Success path: exchange the one-time code for a session -------------
  const cookiesToSet: Array<{ name: string; value: string; options?: Record<string, unknown> }> = [];
  const supabase = createServerClient(env.supabaseUrl, env.supabaseAnonKey, {
    cookies: {
      getAll() {
        return request.cookies.getAll();
      },
      setAll(setters) {
        setters.forEach(({ name, value }) => request.cookies.set(name, value));
        cookiesToSet.push(...setters);
      },
    },
  });

  // Success outcomes imply a code was present (resolveCallbackOutcome
  // guarantees it); take it from the request query.
  const code = sp.get("code");
  if (!code) return redirectTo("/verify-email", { status: "invalid" });

  const { error } = await supabase.auth.exchangeCodeForSession(code);
  if (error) {
    console.error("[auth] exchangeCodeForSession failed:", error.message);
    const expired = /expired|used|invalid|not found/i.test(error.message);
    if (outcome.type === "recovery") {
      return redirectTo("/reset-password", { error: "invalid" });
    }
    return redirectTo("/verify-email", { status: expired ? "expired" : "invalid" });
  }

  // Redirect with the fresh session cookies attached (the PKCE exchange
  // rotated the auth cookies, so they must ride on THIS response).
  // Verification success carries `fresh=1` so /verify-email can distinguish
  // "just verified now" from "already verified earlier".
  const target = redirectUrl(outcome.next);
  if (outcome.type === "verification") target.searchParams.set("fresh", "1");
  const response = NextResponse.redirect(target);
  for (const { name, value, options } of cookiesToSet) {
    response.cookies.set(name, value, options as never);
  }
  return response;
}
