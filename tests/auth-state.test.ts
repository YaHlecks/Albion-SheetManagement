import { describe, expect, it } from "vitest";
import {
  resolveAuthState,
  resolveCallbackOutcome,
  safeNext,
  mapSignInError,
  RESEND_COOLDOWN_SECONDS,
} from "@/lib/auth-state";

/**
 * Unit tests for the explicit authentication state machine: email
 * verification, account approval and password recovery are three separate
 * concepts, and the flow decisions are pinned here so a regression (e.g.
 * "profile DB error reported as pending approval" or "verification link
 * opening the reset form") cannot silently return.
 */

describe("resolveAuthState (email verification ⊕ account approval)", () => {
  it("EMAIL_UNVERIFIED is decided purely from the auth provider, before anything else", () => {
    expect(
      resolveAuthState({ emailConfirmed: false, profileStatus: "pending", isPlatformAdmin: false })
    ).toBe("EMAIL_UNVERIFIED");
    // Even a DB failure must not mask an unverified email.
    expect(
      resolveAuthState({ emailConfirmed: false, profileStatus: null, isPlatformAdmin: false })
    ).toBe("EMAIL_UNVERIFIED");
  });

  it("PROFILE_ERROR ≠ PENDING_APPROVAL: a failed profile read stays a database error", () => {
    expect(
      resolveAuthState({ emailConfirmed: true, profileStatus: null, isPlatformAdmin: false })
    ).toBe("PROFILE_ERROR");
    expect(
      resolveAuthState({ emailConfirmed: true, profileStatus: null, isPlatformAdmin: true })
    ).toBe("PROFILE_ERROR");
  });

  it("pending → PENDING_APPROVAL (member)", () => {
    expect(
      resolveAuthState({ emailConfirmed: true, profileStatus: "pending", isPlatformAdmin: false })
    ).toBe("PENDING_APPROVAL");
  });

  it("approved member → ACTIVE_MEMBER; approved admin → ACTIVE_ADMIN", () => {
    expect(
      resolveAuthState({ emailConfirmed: true, profileStatus: "approved", isPlatformAdmin: false })
    ).toBe("ACTIVE_MEMBER");
    expect(
      resolveAuthState({ emailConfirmed: true, profileStatus: "approved", isPlatformAdmin: true })
    ).toBe("ACTIVE_ADMIN");
  });

  it("moderation states map 1:1", () => {
    expect(
      resolveAuthState({ emailConfirmed: true, profileStatus: "suspended", isPlatformAdmin: false })
    ).toBe("SUSPENDED");
    expect(
      resolveAuthState({ emailConfirmed: true, profileStatus: "rejected", isPlatformAdmin: false })
    ).toBe("REJECTED");
    expect(
      resolveAuthState({ emailConfirmed: true, profileStatus: "archived", isPlatformAdmin: false })
    ).toBe("ARCHIVED");
  });
});

describe("resolveCallbackOutcome (verification vs recovery separation)", () => {
  const base = {
    code: null as string | null,
    error: null as string | null,
    errorCode: null as string | null,
    errorDescription: null as string | null,
    type: null as string | null,
    next: null as string | null,
    supabaseConfigured: true,
  };

  it("verification link (no type) → success type=verification → /verify-email", () => {
    const out = resolveCallbackOutcome({ ...base, code: "abc" });
    expect(out).toEqual({ kind: "success", type: "verification", next: "/verify-email" });
  });

  it("recovery link (type=recovery) → success type=recovery → /reset-password", () => {
    const out = resolveCallbackOutcome({ ...base, code: "abc", type: "recovery" });
    expect(out).toEqual({ kind: "success", type: "recovery", next: "/reset-password" });
  });

  it("custom safe next is honored for both flows", () => {
    expect(resolveCallbackOutcome({ ...base, code: "abc", next: "/events" })).toEqual({
      kind: "success",
      type: "verification",
      next: "/events",
    });
    expect(resolveCallbackOutcome({ ...base, code: "abc", type: "recovery", next: "/reset-password" })).toEqual({
      kind: "success",
      type: "recovery",
      next: "/reset-password",
    });
  });

  it("expired verification link → otp_expired (never a reset redirect)", () => {
    const out = resolveCallbackOutcome({
      ...base,
      error: "invalid_request",
      errorCode: "otp_expired",
      errorDescription: "Email link is invalid or has expired",
    });
    expect(out).toEqual({ kind: "error", code: "otp_expired" });
  });

  it("expired recovery link → otp_expired as well (flow split happens in the route)", () => {
    const out = resolveCallbackOutcome({
      ...base,
      type: "recovery",
      errorCode: "otp_expired",
      errorDescription: "Email link is invalid or has expired",
    });
    expect(out).toEqual({ kind: "error", code: "otp_expired" });
  });

  it("generic failure without code → otp_failed", () => {
    expect(resolveCallbackOutcome({ ...base, error: "server_error" })).toEqual({
      kind: "error",
      code: "otp_failed",
    });
  });

  it("missing code and no error params → otp_failed (malformed visit)", () => {
    expect(resolveCallbackOutcome(base)).toEqual({ kind: "error", code: "otp_failed" });
  });

  it("unconfigured environment → config error", () => {
    expect(resolveCallbackOutcome({ ...base, code: "abc", supabaseConfigured: false })).toEqual({
      kind: "error",
      code: "config",
    });
  });
});

describe("safeNext (open-redirect guard)", () => {
  it("accepts internal paths", () => {
    expect(safeNext("/dashboard", "/login")).toBe("/dashboard");
  });
  it("rejects external and protocol-relative URLs", () => {
    expect(safeNext("https://evil.example", "/login")).toBe("/login");
    expect(safeNext("//evil.example", "/login")).toBe("/login");
  });
  it("rejects callback loops", () => {
    expect(safeNext("/auth/callback", "/login")).toBe("/login");
  });
  it("falls back on empty input", () => {
    expect(safeNext(null, "/login")).toBe("/login");
    expect(safeNext("", "/login")).toBe("/login");
  });
});

describe("mapSignInError (Email-not-confirmed vs bad credentials)", () => {
  it("detects 'Email not confirmed' even though it arrives as HTTP 400", () => {
    expect(mapSignInError(400, "Email not confirmed")).toEqual({ kind: "email_not_verified" });
    expect(mapSignInError(400, "email_not_confirmed")).toEqual({ kind: "email_not_verified" });
    // Case/whitespace variations from the Auth server.
    expect(mapSignInError(400, "Email not confirmed.")).toEqual({ kind: "email_not_verified" });
  });

  it("plain 400 without the message is invalid credentials, not unverified", () => {
    expect(mapSignInError(400, "Invalid login credentials")).toEqual({ kind: "invalid_credentials" });
    expect(mapSignInError(422, "Invalid login credentials")).toEqual({ kind: "invalid_credentials" });
  });

  it("429 → rate_limited", () => {
    expect(mapSignInError(429, "over_email_send_rate_limit")).toEqual({ kind: "rate_limited" });
  });

  it("unknown statuses surface as unknown", () => {
    expect(mapSignInError(500, "Internal error")).toEqual({ kind: "unknown", message: "Internal error" });
    expect(mapSignInError(undefined, undefined)).toEqual({ kind: "unknown", message: undefined });
  });
});

describe("resend cooldown", () => {
  it("is 60 seconds (anti-spam, matches Supabase rate limits)", () => {
    expect(RESEND_COOLDOWN_SECONDS).toBe(60);
  });
});
