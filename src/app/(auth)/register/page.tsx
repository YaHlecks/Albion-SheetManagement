"use client";

import { useState, type FormEvent } from "react";
import Link from "next/link";
import { Eye, EyeOff, MailCheck } from "lucide-react";
import { createBrowserClient } from "@/lib/supabase-browser";
import { getAuthCallbackUrl } from "@/lib/app-url";
import { registerSchema, fieldErrors } from "@/lib/validation";
import { Button } from "@/components/ui";
import { ResendVerification } from "@/components/resend-verification";

export default function RegisterPage() {
  const [form, setForm] = useState({ ign: "", email: "", discord: "", password: "", confirmPassword: "" });
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [banner, setBanner] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);
  /** null = form; otherwise the address the verification email was sent to. */
  const [pendingEmail, setPendingEmail] = useState<string | null>(null);
  const [showPassword, setShowPassword] = useState(false);

  function set<K extends keyof typeof form>(key: K, value: string) {
    setForm((f) => ({ ...f, [key]: value }));
  }

  async function checkIgnDuplicate(ign: string, supabase: ReturnType<typeof createBrowserClient>): Promise<string | null> {
    // Security-definer RPC: anonymous visitors cannot read profiles via RLS,
    // so availability is checked inside the database instead.
    const { data, error } = await supabase.rpc("check_ign_available", { p_ign: ign });
    if (error) return null; // Fail open; DB constraints remain authoritative.
    if (data === false) return "This IGN is already registered. If this is you, try logging in.";
    return null;
  }

  async function handleSubmit(e: FormEvent) {
    e.preventDefault();
    setBanner(null);

    const parsed = registerSchema.safeParse(form);
    if (!parsed.success) {
      setErrors(fieldErrors(parsed));
      return;
    }
    setErrors({});
    setLoading(true);

    try {
      const supabase = createBrowserClient();

      const duplicateMsg = await checkIgnDuplicate(parsed.data.ign, supabase);
      if (duplicateMsg) {
        setErrors({ ign: duplicateMsg });
        return;
      }

      const { data, error } = await supabase.auth.signUp({
        email: parsed.data.email,
        password: parsed.data.password,
        options: {
          data: { ign: parsed.data.ign, discord: parsed.data.discord || null },
          // Env-based verification callback (NEXT_PUBLIC_APP_URL →
          // VERCEL_URL → current origin fallback); /verify-email renders the
          // "Email verified" experience — never the password-reset page.
          emailRedirectTo: `${getAuthCallbackUrl()}?next=/verify-email`,
        },
      });

      if (error) {
        if (error.message.includes("already registered")) {
          setErrors({ email: "An account with this email already exists." });
        } else if (error.message.includes("Password")) {
          setErrors({ password: "Password does not meet the requirements." });
        } else if (error.message.includes("rate limit")) {
          setBanner("Too many attempts. Please wait a moment and try again.");
        } else {
          setBanner("Registration failed. Please try again.");
        }
        return;
      }

      // Registration succeeded. Whether or not Supabase returned a session
      // (it returns one only when email confirmation is disabled in the
      // project settings), the account is NOT considered verified here.
      // The user must complete email verification first.
      setPendingEmail(parsed.data.email);
    } catch {
      setBanner("Network error. Check your connection and try again.");
    } finally {
      setLoading(false);
    }
  }

  // -----------------------------------------------------------------------
  // "Check your email" state — the required post-registration experience.
  // Registration ≠ verification: the account exists, the email is not
  // confirmed until the user clicks "Verify My Account" in the email.
  // -----------------------------------------------------------------------
  if (pendingEmail) {
    return (
      <div className="auth-card text-center">
        <span className="mx-auto mb-4 flex h-12 w-12 items-center justify-center rounded-full bg-info-soft text-info">
          <MailCheck size={22} />
        </span>
        <h1 className="font-display text-2xl font-bold tracking-tight">Check your email</h1>
        <p className="mt-3 text-sm leading-relaxed text-muted">
          We&apos;ve sent a verification email to:
        </p>
        <p className="mt-1 text-sm font-semibold text-ink break-all">{pendingEmail}</p>
        <p className="mt-4 text-sm leading-relaxed text-muted">
          Click <strong className="text-ink">&ldquo;Verify My Account&rdquo;</strong> in that email
          to verify your address. After verification you can sign in — new member accounts then
          wait briefly for administrator approval.
        </p>
        <p className="mt-3 text-xs text-faint">
          No email? Check your spam or junk folder — sometimes it lands there.
        </p>

        <ResendVerification email={pendingEmail} className="mt-4" />

        <div className="mt-5 border-t border-line pt-4">
          <p className="text-xs text-muted">Already verified?</p>
          <Link href="/login" className="btn btn-secondary mt-2 w-full">
            Return to login
          </Link>
        </div>
      </div>
    );
  }

  return (
    <div className="auth-card">
      <h1 className="font-display text-2xl font-bold tracking-tight">Create your account</h1>
      <p className="mt-1 text-sm text-muted">Register to join your guild&apos;s team sheets.</p>

      {banner ? (
        <div className="form-banner form-banner-error mt-5" role="alert">{banner}</div>
      ) : null}

      <form onSubmit={handleSubmit} className="mt-6 space-y-4" noValidate>
        <div>
          <label htmlFor="ign" className="field-label">Albion IGN *</label>
          <input
            id="ign"
            className={`field ${errors.ign ? "field-error" : ""}`}
            value={form.ign}
            onChange={(e) => set("ign", e.target.value)}
            placeholder="Your in-game name"
            autoComplete="username"
            maxLength={32}
          />
          {errors.ign ? <p className="form-error">{errors.ign}</p> : null}
        </div>

        <div>
          <label htmlFor="reg-email" className="field-label">Email *</label>
          <input
            id="reg-email"
            type="email"
            className={`field ${errors.email ? "field-error" : ""}`}
            value={form.email}
            onChange={(e) => set("email", e.target.value)}
            placeholder="you@example.com"
            autoComplete="email"
          />
          {errors.email ? <p className="form-error">{errors.email}</p> : null}
        </div>

        <div>
          <label htmlFor="discord" className="field-label">Discord <span className="font-normal text-faint">(optional)</span></label>
          <input
            id="discord"
            className={`field ${errors.discord ? "field-error" : ""}`}
            value={form.discord}
            onChange={(e) => set("discord", e.target.value)}
            placeholder="username"
            maxLength={64}
          />
          {errors.discord ? <p className="form-error">{errors.discord}</p> : null}
        </div>

        <div>
          <label htmlFor="reg-password" className="field-label">Password *</label>
          <div className="relative">
            <input
              id="reg-password"
              type={showPassword ? "text" : "password"}
              className={`field pr-10 ${errors.password ? "field-error" : ""}`}
              value={form.password}
              onChange={(e) => set("password", e.target.value)}
              placeholder="Min. 8 characters, letter + number"
              autoComplete="new-password"
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

        <div>
          <label htmlFor="confirm" className="field-label">Confirm password *</label>
          <input
            id="confirm"
            type={showPassword ? "text" : "password"}
            className={`field ${errors.confirmPassword ? "field-error" : ""}`}
            value={form.confirmPassword}
            onChange={(e) => set("confirmPassword", e.target.value)}
            placeholder="Repeat your password"
            autoComplete="new-password"
          />
          {errors.confirmPassword ? <p className="form-error">{errors.confirmPassword}</p> : null}
        </div>

        <Button type="submit" loading={loading} className="w-full">
          {loading ? "Creating account…" : "Create account"}
        </Button>
      </form>

      <p className="mt-6 text-center text-sm text-muted">
        Already have an account? <Link href="/login" className="link-brand">Log in</Link>
      </p>
    </div>
  );
}
