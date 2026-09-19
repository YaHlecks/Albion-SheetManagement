"use client";

import { Suspense, useState, type FormEvent } from "react";
import Link from "next/link";
import { useRouter, useSearchParams } from "next/navigation";
import { Eye, EyeOff } from "lucide-react";
import { createBrowserClient } from "@/lib/supabase-browser";
import { loginSchema, fieldErrors } from "@/lib/validation";
import { Button } from "@/components/ui";
import { useToast } from "@/components/toast";

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
  const [loading, setLoading] = useState(false);

  async function handleSubmit(e: FormEvent) {
    e.preventDefault();
    setBanner(null);
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
        if (error.status === 400) {
          setBanner("Invalid email or password.");
        } else if (error.status === 422) {
          setBanner("Invalid email or password.");
        } else if (error.status === 429) {
          setBanner("Too many attempts. Please wait a moment and try again.");
        } else {
          setBanner("Could not sign you in. Please try again.");
        }
        return;
      }

      // Resolve account status before entering the app.
      const { data: profile, error: profileError } = await supabase
        .from("profiles")
        .select("status")
        .eq("id", data.user.id)
        .maybeSingle();

      if (profileError || !profile) {
        setBanner("Could not verify your account. Please try again.");
        await supabase.auth.signOut();
        return;
      }

      if (profile.status === "pending") {
        await supabase.auth.signOut();
        router.replace("/pending-approval?status=pending");
        return;
      }
      if (profile.status === "suspended") {
        await supabase.auth.signOut();
        router.replace("/pending-approval?status=suspended");
        return;
      }
      if (profile.status === "rejected") {
        await supabase.auth.signOut();
        router.replace("/pending-approval?status=rejected");
        return;
      }

      toast.success("Signed in. Welcome back!");
      // Record login time + USER_LOGIN audit event (fire-and-forget).
      void supabase.rpc("touch_login");
      const next = params.get("next");
      router.replace(next && next.startsWith("/") ? next : "/dashboard");
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
