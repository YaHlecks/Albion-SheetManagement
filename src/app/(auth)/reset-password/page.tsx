"use client";

import { useState, type FormEvent } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { createBrowserClient } from "@/lib/supabase-browser";
import { resetSchema, fieldErrors } from "@/lib/validation";
import { Button } from "@/components/ui";

export default function ResetPasswordPage() {
  const router = useRouter();
  const [password, setPassword] = useState("");
  const [confirmPassword, setConfirmPassword] = useState("");
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [banner, setBanner] = useState<string | null>(
    typeof window !== "undefined" && window.location.search.includes("error=invalid")
      ? "This reset link is invalid or has expired. Request a new one."
      : null
  );
  const [loading, setLoading] = useState(false);

  async function handleSubmit(e: FormEvent) {
    e.preventDefault();
    const parsed = resetSchema.safeParse({ password, confirmPassword });
    if (!parsed.success) {
      setErrors(fieldErrors(parsed));
      return;
    }
    setErrors({});
    setLoading(true);
    try {
      const supabase = createBrowserClient();
      const { error } = await supabase.auth.updateUser({ password: parsed.data.password });
      if (error) {
        setBanner(
          error.message.includes("session") || error.message.includes("Not logged")
            ? "Your reset link has expired. Request a new one."
            : "Could not update the password. Please try again."
        );
        return;
      }
      await supabase.auth.signOut();
      router.replace("/login?reset=1");
    } catch {
      setBanner("Network error. Check your connection and try again.");
    } finally {
      setLoading(false);
    }
  }

  return (
    <div className="auth-card">
      <h1 className="font-display text-2xl font-bold tracking-tight">Set a new password</h1>
      <p className="mt-1 text-sm text-muted">Choose a strong password for your account.</p>

      {banner ? <div className="form-banner form-banner-error mt-5" role="alert">{banner}</div> : null}

      <form onSubmit={handleSubmit} className="mt-6 space-y-4" noValidate>
        <div>
          <label htmlFor="new-password" className="field-label">New password</label>
          <input
            id="new-password"
            type="password"
            className={`field ${errors.password ? "field-error" : ""}`}
            value={password}
            onChange={(e) => setPassword(e.target.value)}
            placeholder="Min. 8 characters, letter + number"
            autoComplete="new-password"
          />
          {errors.password ? <p className="form-error">{errors.password}</p> : null}
        </div>
        <div>
          <label htmlFor="confirm-new" className="field-label">Confirm password</label>
          <input
            id="confirm-new"
            type="password"
            className={`field ${errors.confirmPassword ? "field-error" : ""}`}
            value={confirmPassword}
            onChange={(e) => setConfirmPassword(e.target.value)}
            placeholder="Repeat your password"
            autoComplete="new-password"
          />
          {errors.confirmPassword ? <p className="form-error">{errors.confirmPassword}</p> : null}
        </div>
        <Button type="submit" loading={loading} className="w-full">
          {loading ? "Updating…" : "Update password"}
        </Button>
      </form>

      <p className="mt-6 text-center text-sm text-muted">
        <Link href="/login" className="link-brand">Back to login</Link>
      </p>
    </div>
  );
}
