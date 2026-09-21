"use client";

import { Suspense, useState, type FormEvent } from "react";
import Link from "next/link";
import { useRouter, useSearchParams } from "next/navigation";
import { Eye, EyeOff } from "lucide-react";
import { createBrowserClient } from "@/lib/supabase-browser";
import { loginSchema, fieldErrors } from "@/lib/validation";
import { mapSignInError, classifyProfileError } from "@/lib/auth-state";
import { Button } from "@/components/ui";
import { useToast } from "@/components/toast";
import { ResendVerification } from "@/components/resend-verification";

function LoginForm() {
  const router = useRouter();
  const params = useSearchParams();
  const toast = useToast();
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [showPassword, setShowPassword] = useState(false);
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [banner, setBanner] = useState<string | null>(
    params.get("error") === "config"
      ? "Authentication is not configured on this deployment. Set NEXT_PUBLIC_SUPABASE_URL and NEXT_PUBLIC_SUPABASE_ANON_KEY."
      : null
  );
  /** When sign-in fails with "Email not confirmed", show the resend block. */
  const [showResend, setShowResend] = useState(false);
  const [loading, setLoading] = useState(false);

  async function handleSubmit(e: FormEvent) {
    e.preventDefault();
    setBanner(null);
    setShowResend(false);
    const parsed = loginSchema.safeParse({ email, password });
    if (!parsed.success) {
      setErrors(fieldErrors(parsed));
      return;
    }
    setErrors({});
    setLoading(true);

    try {
      const supabase = createBrowserClient();
      const { data, error } = await supabase.auth.signInWithPassword({
        email: parsed.data.email,
        password: parsed.data.password,
      });

      if (error) {
        // §15: distinguish authentication failure from email-not-verified.
        // "Email not confirmed" is HTTP 400 — identical status to bad
        // credentials — so the message must be inspected (mapSignInError).
        const mapped = mapSignInError(error.status, error.message);
        switch (mapped.kind) {
          case "email_not_verified":
            setBanner("Email not verified — please verify your email address before signing in.");
            setShowResend(true);
            return;
          case "rate_limited":
            setBanner("Too many attempts. Please wait a moment and try again.");
            return;
          case "invalid_credentials":
            setBanner("Invalid email or password.");
            return;
          default:
            setBanner("Could not sign you in. Please try again.");
            return;
        }
      }

      // ---- SESSION LOADED → PROFILE RESOLVED → ROUTE DECISION ---------------
      // Self-heal 1/2: if the signup trigger has not created the profile yet
      // (race on a brand-new account), the definer RPC provisions it now
      // from the verified JWT. A DB failure here is NOT "pending" — keep the
      // session and surface a distinct profile-error state (§16/§17).
      const { data: ensured, error: ensureError } = await supabase.rpc("ensure_profile");
      if (ensureError || !ensured?.ok) {
        // §14: classify precisely — 42501 (permission denied) is a grants/RLS
        // misconfiguration and must NEVER surface as pending/unverified.
        const kind = classifyProfileError(ensureError?.code, ensureError?.message);
        console.error(
          `[auth] ensure_profile failed (${kind}):`,
          ensureError?.message ?? ensured?.error
        );
        router.replace(`/pending-approval?error=${kind === "PROFILE_PERMISSION_DENIED" ? "profile-permission" : "profile-db"}`);
        return; // session deliberately kept — error state, not a logout
      }

      // Self-heal 2/2: repair deployments whose earliest account registered
      // before the first-admin rule existed (stuck at pending/non-admin).
      // The DB decides — no-op unless the caller is the earliest profile and
      // no administrator exists. Idempotent for everyone else.
      const { data: claim } = await supabase.rpc("claim_first_admin");
      if (claim?.promoted) {
        console.info(`[auth] first-admin self-heal applied: role=ADMIN status=${claim.status}`);
      }

      // Fresh, authoritative read (never cached client state).
      const { data: profile, error: profileError } = await supabase
        .from("profiles")
        .select("status, is_platform_admin")
        .eq("id", data.user.id)
        .maybeSingle();

      if (profileError || !profile) {
        // PROFILE_ERROR ≠ PENDING (§14): classify the failure, log the real
        // cause, keep the session, and show a distinct state with a retry
        // instead of falsely telling an admin their account is unapproved.
        const kind = classifyProfileError(profileError?.code, profileError?.message);
        console.error(`[auth] profile load failed (${kind}):`, profileError?.message);
        router.replace(
          `/pending-approval?error=${kind === "PROFILE_PERMISSION_DENIED" ? "profile-permission" : "profile-db"}`
        );
        return;
      }

      const isAdmin = profile.is_platform_admin === true;
      const status = String(profile.status);
      console.info(
        `[auth] decision: session=authenticated profile=loaded role=${isAdmin ? "ADMIN" : "MEMBER"} status=${status}`
      );

      if (status !== "approved" && status !== "active") {
        // Legit non-approved states only — unreachable for profile-loading /
        // DB-error cases (handled above). Note: an unverified EMAIL can no
        // longer reach this point, so /pending-approval is never shown for
        // verification problems.
        router.replace(`/pending-approval?status=${encodeURIComponent(status)}`);
        return;
      }

      // Record login time + USER_LOGIN audit event before navigating.
      await supabase.rpc("touch_login");

      console.info(
        `[auth] route: requested=${params.get("next") ?? "(default)"} authorized=true redirect=none`
      );
      toast.success("Signed in. Welcome back!");
      const next = params.get("next");
      const fallback = isAdmin ? "/admin" : "/dashboard";
      router.replace(next && next.startsWith("/") ? next : fallback);
      router.refresh();
    } catch {
      setBanner("Network error. Check your connection and try again.");
    } finally {
      setLoading(false);
    }
  }

  return (
    <div className="auth-card">
      <h1 className="font-display text-2xl font-bold tracking-tight">Log in</h1>
      <p className="mt-1 text-sm text-muted">Welcome back. Enter your details to continue.</p>

      {banner ? (
        <div className="form-banner form-banner-error mt-5" role="alert">
          {banner}
        </div>
      ) : null}

      {showResend ? (
        <ResendVerification email={email.trim()} className="mt-4" />
      ) : null}

      <form onSubmit={handleSubmit} className="mt-6 space-y-4" noValidate>
        <div>
          <label htmlFor="email" className="field-label">Email</label>
          <input
            id="email"
            type="email"
            className={`field ${errors.email ? "field-error" : ""}`}
            value={email}
            onChange={(e) => setEmail(e.target.value)}
            placeholder="you@example.com"
            autoComplete="email"
            autoFocus
          />
          {errors.email ? <p className="form-error">{errors.email}</p> : null}
        </div>

        <div>
          <label htmlFor="password" className="field-label">Password</label>
          <div className="relative">
            <input
              id="password"
              type={showPassword ? "text" : "password"}
              className={`field pr-10 ${errors.password ? "field-error" : ""}`}
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              placeholder="••••••••"
              autoComplete="current-password"
            />
            <button
              type="button"
              className="absolute right-2 top-1/2 -translate-y-1/2 rounded p-1.5 text-faint hover:text-ink"
              onClick={() => setShowPassword((v) => !v)}
              aria-label={showPassword ? "Hide password" : "Show password"}
            >
              {showPassword ? <EyeOff size={16} /> : <Eye size={16} />}
            </button>
          </div>
          {errors.password ? <p className="form-error">{errors.password}</p> : null}
        </div>

        <div className="flex items-center justify-between text-sm">
          <label className="inline-flex cursor-pointer select-none items-center gap-2 text-muted">
            <input type="checkbox" className="h-4 w-4 accent-[#e5a13d]" defaultChecked />
            Remember me
          </label>
          <Link href="/forgot-password" className="link-brand">Forgot password?</Link>
        </div>

        <Button type="submit" loading={loading} className="w-full">
          {loading ? "Signing in…" : "Sign in"}
        </Button>
      </form>

      <p className="mt-6 text-center text-sm text-muted">
        No account yet?{" "}
        <Link href="/register" className="link-brand">Create one</Link>
      </p>
    </div>
  );
}

export default function LoginPage() {
  return (
    <Suspense fallback={<div className="auth-card text-sm text-muted">Loading…</div>}>
      <LoginForm />
    </Suspense>
  );
}
