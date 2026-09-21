/**
 * Explicit authentication state model.
 *
 * Three concepts that must never be conflated:
 *
 *   1. Email verification  — auth.users.email_confirmed_at (Supabase Auth)
 *   2. Account approval    — public.profiles.status (pending/approved/…)
 *   3. Password recovery   — a separate flow with its own email and routes
 *
 * The pure functions below are shared by the client pages and unit-tested in
 * tests/auth-state.test.ts, so the flow decisions have one authoritative,
 * testable definition.
 */

export type AccountStatus = "pending" | "approved" | "rejected" | "suspended" | "archived";

/**
 * Canonical states of the application-level auth state machine.
 * LOADING covers session restoration; EMAIL_UNVERIFIED is decided purely from
 * the Supabase user (email_confirmed_at), never inferred from other data.
 */
export type AuthState =
  | "LOADING"
  | "UNAUTHENTICATED"
  | "EMAIL_UNVERIFIED"
  | "PROFILE_LOADING"
  | "PROFILE_ERROR"
  | "PENDING_APPROVAL"
  | "ACTIVE_MEMBER"
  | "ACTIVE_ADMIN"
  | "SUSPENDED"
  | "REJECTED"
  | "ARCHIVED";

/**
 * Decide the auth state from verified primitives.
 *
 * @param emailConfirmed — Supabase: user.email_confirmed_at != null (or the
 *                         `email_confirmed` error signal at sign-in)
 * @param profileStatus  — the account status from public.profiles, or null
 *                         when the profile could not be loaded (DB failure)
 * @param isPlatformAdmin — authoritative is_platform_admin flag
 */
export function resolveAuthState(input: {
  emailConfirmed: boolean;
  profileStatus: AccountStatus | null;
  isPlatformAdmin: boolean;
}): AuthState {
  // Email verification is decided FIRST and only from the auth provider —
  // a database error below must never mask an unverified email.
  if (!input.emailConfirmed) return "EMAIL_UNVERIFIED";

  // PROFILE_ERROR ≠ PENDING_APPROVAL: a failed profile read is a database
  // problem and must be reported as such, never as an approval status.
  if (input.profileStatus === null) return "PROFILE_ERROR";

  switch (input.profileStatus) {
    case "pending":
      return "PENDING_APPROVAL";
    case "approved":
      return input.isPlatformAdmin ? "ACTIVE_ADMIN" : "ACTIVE_MEMBER";
    case "suspended":
      return "SUSPENDED";
    case "rejected":
      return "REJECTED";
    case "archived":
      return "ARCHIVED";
  }
}

/**
 * Outcome of exchanging a Supabase confirmation/recovery code for a session.
 * Kept pure so the callback route and its tests share one decision table.
 */
export type CallbackOutcome =
  /** type === "verification": email confirmation link → never touches reset UI */
  | { kind: "success"; type: "verification"; next: string }
  /** type === "recovery": password-reset link → leads to /reset-password */
  | { kind: "success"; type: "recovery"; next: string }
  /** Supabase reported an error (otp expired/invalid/used) */
  | { kind: "error"; code: "otp_expired" | "otp_failed" }
  /** missing or malformed ?code= */
  | { kind: "error"; code: "missing_code" }
  /** server env not configured */
  | { kind: "error"; code: "config" };

/** Safe internal redirect targets after a successful exchange. */
export function safeNext(rawNext: string | null | undefined, fallback: string): string {
  if (!rawNext) return fallback;
  if (!rawNext.startsWith("/")) return fallback;
  if (rawNext.startsWith("//")) return fallback; // protocol-relative external URL
  if (rawNext.startsWith("/auth/callback")) return fallback; // never loop back here
  return rawNext;
}

/**
 * Decide the destination of the confirmation callback from the request query.
 *
 * Supabase reuses the same callback URL for both email confirmation and
 * password recovery, so the *flow* is distinguished here, not by URL:
 *   - recovery links carry `type=recovery` in the query (Supabase adds it for
 *     PASSWORD_RECOVERY) → destination /reset-password (keeps the session the
 *     recovery link established)
 *   - signup/confirmation links carry no type → destination /verify-email,
 *     which shows the dedicated verification experience
 */
export function resolveCallbackOutcome(params: {
  code: string | null;
  error: string | null;
  errorCode: string | null;
  errorDescription: string | null;
  type: string | null;
  next: string | null;
  supabaseConfigured: boolean;
}): CallbackOutcome {
  if (!params.supabaseConfigured) return { kind: "error", code: "config" };

  if (params.code) {
    const isRecovery = params.type === "recovery";
    const next = safeNext(params.next, isRecovery ? "/reset-password" : "/verify-email");
    return isRecovery
      ? { kind: "success", type: "recovery", next }
      : { kind: "success", type: "verification", next };
  }

  // No code → Supabase bounced the link back with error params
  // (e.g. otp_expired / otp_invalid / already-used tokens).
  const errorCode = (params.errorCode ?? params.error ?? "").toLowerCase();
  const description = (params.errorDescription ?? "").toLowerCase();
  const expiredOrInvalid =
    errorCode.includes("otp") ||
    errorCode.includes("expired") ||
    errorCode.includes("invalid") ||
    description.includes("expired") ||
    description.includes("invalid");
  return expiredOrInvalid
    ? { kind: "error", code: "otp_expired" }
    : { kind: "error", code: "otp_failed" };
}

/**
 * Map a Supabase signInWithPassword error to a UI state.
 *
 * CRITICAL: `Email not confirmed` arrives as HTTP 400 — the same status as
 * bad credentials — so status alone cannot distinguish them. The message
 * must be inspected, otherwise unverified users are told their password is
 * wrong (the original bug behind the "Email not confirmed" report).
 */
export type SignInError =
  | { kind: "invalid_credentials" }
  | { kind: "email_not_verified" }
  | { kind: "rate_limited" }
  | { kind: "unknown"; message?: string };

export function mapSignInError(status: number | undefined, message: string | undefined): SignInError {
  const msg = (message ?? "").toLowerCase();
  if (msg.includes("email not confirmed") || msg.includes("email_not_confirmed")) {
    return { kind: "email_not_verified" };
  }
  if (status === 429) return { kind: "rate_limited" };
  if (status === 400 || status === 422) return { kind: "invalid_credentials" };
  return { kind: "unknown", message };
}

/** Cooldown (seconds) between two verification-email requests (anti-spam). */
export const RESEND_COOLDOWN_SECONDS = 60;
