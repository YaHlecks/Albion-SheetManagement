"use client";

/**
 * Create-event client: owns the builder draft. Save Draft (minimal validation,
 * any step) and Publish (strict validation, saves first then transitions the
 * status) are two deliberate actions. On failure the form is preserved so no
 * work is lost, and the real error is surfaced (§30/§32).
 */
import { useState } from "react";
import { useRouter } from "next/navigation";
import { useToast } from "@/components/toast";
import { createBrowserClient } from "@/lib/supabase-browser";
import { EventBuilder } from "@/components/event-builder";
import {
  emptyDraft, saveEvent, setEventStatus, technicalDetail, type EventDraft,
} from "@/lib/events";

export function NewEventClient({ startAsTemplate = false }: { startAsTemplate?: boolean }) {
  const router = useRouter();
  const toast = useToast();
  const supabase = createBrowserClient();
  const [draft, setDraft] = useState<EventDraft>(() => ({ ...emptyDraft(), is_template: startAsTemplate }));
  const [busy, setBusy] = useState(false);

  const save = async (d: EventDraft, thenPublish: boolean) => {
    setBusy(true); // duplicate submissions disabled by loading={busy} on both buttons
    try {
      const { id, created } = await saveEvent(supabase, null, d);
      if (thenPublish) {
        await setEventStatus(supabase, id, "published");
        toast.success("Event published — members notified.");
      } else {
        toast.success(d.is_template ? "Template saved." : created ? "Draft saved." : "Changes saved.");
      }
      router.push(`/admin/events/${id}`);
      router.refresh();
    } catch (err) {
      console.error("[save-event] failed:", err);
      toast.error(`Unable to save the event. Technical error: ${technicalDetail(err)}`);
      // Form state is intentionally untouched — the admin can retry without
      // recreating anything (§32).
    } finally {
      setBusy(false);
    }
  };

  return (
    <EventBuilder
      draft={draft}
      onChange={setDraft}
      busy={busy}
      saveLabel={draft.is_template ? "Save template" : "Save draft"}
      onSave={(d, publish) => void save(d, publish)}
      onCancel={() => router.push("/admin/events")}
    />
  );
}
