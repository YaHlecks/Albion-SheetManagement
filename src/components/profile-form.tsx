"use client";

import { useState, type FormEvent } from "react";
import { createBrowserClient } from "@/lib/supabase-browser";
import { profileUpdateSchema, fieldErrors } from "@/lib/validation";
import { Button, Card } from "@/components/ui";
import { useToast } from "@/components/toast";

export function ProfileForm({ ign, discord, email }: { ign: string; discord: string; email: string }) {
  const toast = useToast();
  const [form, setForm] = useState({ ign, discord });
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [saving, setSaving] = useState(false);

  async function handleSubmit(e: FormEvent) {
    e.preventDefault();
    const parsed = profileUpdateSchema.safeParse(form);
    if (!parsed.success) {
      setErrors(fieldErrors(parsed));
      return;
    }
    setErrors({});
    setSaving(true);
    try {
      const supabase = createBrowserClient();
      const { error } = await supabase
        .from("profiles")
        .update({ ign: parsed.data.ign, discord: parsed.data.discord || null })
        .eq("id", (await supabase.auth.getUser()).data.user?.id ?? "");

      if (error) {
        toast.error(error.message.includes("duplicate") || error.message.includes("unique")
          ? "This IGN is already taken."
          : "Could not save your profile.");
        return;
      }
      toast.success("Profile updated.");
    } catch {
      toast.error("Network error — profile not saved.");
    } finally {
      setSaving(false);
    }
  }

  return (
    <Card className="p-5">
      <h2 className="section-title mb-4">Editable details</h2>
      <form onSubmit={handleSubmit} className="space-y-4" noValidate>
        <div className="grid gap-4 sm:grid-cols-2">
          <div>
            <label htmlFor="pf-ign" className="field-label">Albion IGN</label>
            <input
              id="pf-ign"
              className={`field ${errors.ign ? "field-error" : ""}`}
              value={form.ign}
              onChange={(e) => setForm((f) => ({ ...f, ign: e.target.value }))}
              maxLength={32}
            />
            {errors.ign ? <p className="form-error">{errors.ign}</p> : null}
          </div>
          <div>
            <label htmlFor="pf-discord" className="field-label">Discord</label>
            <input
              id="pf-discord"
              className={`field ${errors.discord ? "field-error" : ""}`}
              value={form.discord}
              onChange={(e) => setForm((f) => ({ ...f, discord: e.target.value }))}
              maxLength={64}
              placeholder="username"
            />
            {errors.discord ? <p className="form-error">{errors.discord}</p> : null}
          </div>
        </div>
        <div className="flex items-center justify-between gap-3">
          <p className="text-xs text-faint">Email ({email}) cannot be changed here.</p>
          <Button type="submit" loading={saving}>Save changes</Button>
        </div>
      </form>
    </Card>
  );
}
