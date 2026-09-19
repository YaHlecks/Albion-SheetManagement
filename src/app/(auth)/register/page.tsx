"use client";

import { useState, type FormEvent } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { Eye, EyeOff } from "lucide-react";
import { createBrowserClient } from "@/lib/supabase-browser";
import { registerSchema, fieldErrors } from "@/lib/validation";
import { Button } from "@/components/ui";

export default function RegisterPage() {
  const router = useRouter();
  const [form, setForm] = useState({ ign: "", email: "", discord: "", password: "", confirmPassword: "" });
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [banner, setBanner] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);
  const [done, setDone] = useState(false);
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

      const redirectUrl =
        typeof window !== "undefined"
          ? `${window.location.origin}/auth/callback?next=/login?registered=1`
          : undefined;

      const { data, error } = await supabase.auth.signUp({
        email: parsed.data.email,
        password: parsed.data.password,
        options: {
          data: { ign: parsed.data.ign, discord: parsed.data.discord || null },
          emailRedirectTo: redirectUrl,
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

      if (data.user && !data.session) {
        // Email confirmation required.
        setDone(true);
        return;
      }

      // Signed up without confirmation requirement — mark success and exit.
      setDone(true);
    } catch {
      setBanner("Network error. Check your connection and try again.");
    } finally {
      setLoading(false);
    }
  }

  if (done) {
    return (
      <div className="auth-card text-center">
        <span className="mx-auto mb-4 flex h-12 w-12 items-center justify-center rounded-full bg-success-soft text-success">
          <svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
            <path d="M20 6 9 17l-5-5" />
          </svg>
        </span>
        <h1 className="font-display text-2xl font-bold tracking-tight">Registration successful</h1>
        <p className="mt-3 text-sm leading-relaxed text-muted">
          Your account has been created and is currently <strong className="text-warn">waiting for administrator approval</strong>.
          You will be able to log in once an administrator approves it.
        </p>
        <p className="mt-2 text-xs text-faint">
          If email confirmation is enabled, check your inbox first to verify your address.
        </p>
        <Link href="/login" className="btn btn-secondary mt-6 w-full">
          Back to login
        </Link>
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
