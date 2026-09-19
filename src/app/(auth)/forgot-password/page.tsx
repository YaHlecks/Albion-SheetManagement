 "use client";

import { useState, type FormEvent } from "react";
import Link from "next/link";
import { Button } from "@/components/ui";

export default function ForgotPasswordPage() {
  const [email, setEmail] = useState("");
  const [sent, setSent] = useState(false);
  const [loading, setLoading] = useState(false);
  const [banner, setBanner] = useState<string | null>(null);

  async function handleSubmit(e: FormEvent) {
    e.preventDefault();
    const trimmed = email.trim().toLowerCase();
    if (!trimmed || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(trimmed)) {
      setBanner("Enter a valid email address.");
      return;
    }
    setBanner(null);
    setLoading(true);
    try {
      const redirectTo =
        typeof window !== "undefined"
          ? `${window.location.origin}/auth/callback?next=/reset-password`
          : undefined;

      // Rate-limited, server-proxied request. The response does not reveal
      // whether the address exists — no account enumeration.
      const res = await fetch("/api/auth/recover", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ email: trimmed }),
      });

      if (!res.ok && res.status !== 200) {
        setBanner("Could not send the reset email. Please try again later.");
        return;
      }

      setSent(true);
    } catch {
      setBanner("Network error. Check your connection and try again.");
    } finally {
      setLoading(false);
    }
  }

  if (sent) {
    return (
      <div className="auth-card text-center">
        <h1 className="font-display text-2xl font-bold tracking-tight">Check your inbox</h1>
        <p className="mt-3 text-sm leading-relaxed text-muted">
          If an account exists for <strong className="text-ink">{email}</strong>, a password reset
          link has been sent. The link expires after a short time.
        </p>
        <Link href="/login" className="btn btn-secondary mt-6 w-full">
          Back to login
        </Link>
      </div>
    );
  }

  return (
    <div className="auth-card">
      <h1 className="font-display text-2xl font-bold tracking-tight">Forgot your password?</h1>
      <p className="mt-1 text-sm text-muted">
        Enter your email and we&apos;ll send you a reset link.
      </p>

      {banner ? <div className="form-banner form-banner-error mt-5" role="alert">{banner}</div> : null}

      <form onSubmit={handleSubmit} className="mt-6 space-y-4" noValidate>
        <div>
          <label htmlFor="fp-email" className="field-label">Email</label>
          <input
            id="fp-email"
            type="email"
            className="field"
            value={email}
            onChange={(e) => setEmail(e.target.value)}
            placeholder="you@example.com"
            autoComplete="email"
            autoFocus
          />
        </div>
        <Button type="submit" loading={loading} className="w-full">
          {loading ? "Sending…" : "Send reset link"}
        </Button>
      </form>

      <p className="mt-6 text-center text-sm text-muted">
        Remembered it? <Link href="/login" className="link-brand">Log in</Link>
      </p>
    </div>
  );
}
