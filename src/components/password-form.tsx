"use client";

import { useState, type FormEvent } from "react";
import { createBrowserClient } from "@/lib/supabase-browser";
import { resetSchema, fieldErrors } from "@/lib/validation";
import { Button } from "@/components/ui";
import { useToast } from "@/components/toast";

export function PasswordChangeForm() {
  const toast = useToast();
  const [password, setPassword] = useState("");
  const [confirm, setConfirm] = useState("");
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [saving, setSaving] = useState(false);

  async function handleSubmit(e: FormEvent) {
    e.preventDefault();
    const parsed = resetSchema.safeParse({ password, confirmPassword: confirm });
    if (!parsed.success) {
      setErrors(fieldErrors(parsed));
      return;
    }
    setErrors({});
    setSaving(true);
    try {
      const supabase = createBrowserClient();
      const { error } = await supabase.auth.updateUser({ password: parsed.data.password });
      if (error) {
        toast.error("Could not update the password. Sign in again and retry.");
        return;
      }
      toast.success("Password updated.");
      setPassword("");
      setConfirm("");
    } catch {
      toast.error("Network error — password not changed.");
    } finally {
      setSaving(false);
    }
  }

  return (
    <div className="panel p-5">
      <h2 className="section-title mb-4">Change password</h2>
      <form onSubmit={handleSubmit} className="space-y-4" noValidate>
        <div className="grid gap-4 sm:grid-cols-2">
          <div>
            <label htmlFor="pw-new" className="field-label">New password</label>
            <input
              id="pw-new"
              type="password"
              className={`field ${errors.password ? "field-error" : ""}`}
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              autoComplete="new-password"
            />
            {errors.password ? <p className="form-error">{errors.password}</p> : null}
          </div>
          <div>
            <label htmlFor="pw-confirm" className="field-label">Confirm password</label>
            <input
              id="pw-confirm"
              type="password"
              className={`field ${errors.confirmPassword ? "field-error" : ""}`}
              value={confirm}
              onChange={(e) => setConfirm(e.target.value)}
              autoComplete="new-password"
            />
            {errors.confirmPassword ? <p className="form-error">{errors.confirmPassword}</p> : null}
          </div>
        </div>
        <div className="flex justify-end">
          <Button type="submit" variant="secondary" loading={saving}>Update password</Button>
        </div>
      </form>
    </div>
  );
}
