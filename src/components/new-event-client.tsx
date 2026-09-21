"use client";

/**
 * Create-event client: owns the builder draft, saves via the save_event RPC,
 * then offers publish. Explicit save strategy — publish is deliberate (§16).
 */
import { useState } from "react";
import { useRouter } from "next/navigation";
import { useToast } from "@/components/toast";
import { createBrowserClient } from "@/lib/supabase-browser";
import { EventBuilder } from "@/components/event-builder";
import { emptyDraft, saveEvent, setEventStatus, type EventDraft } from "@/lib/events";

export function NewEventClient({ startAsTemplate = false }: { startAsTemplate?: boolean }) {
  const router = useRouter();
  const toast = useToast();
  const supabase = createBrowserClient();
  const [draft, setDraft] = useState<EventDraft>(() => ({ ...emptyDraft(), is_template: startAsTemplate }));
  const [busy, setBusy] = useState(false);
  const [savedId, setSavedId] = useState<string | null>(null);

  const save = async (d: EventDraft, thenPublish: boolean) => {
    setBusy(true);
    try {
      const { id, created } = await saveEvent(supabase, savedId, d);
      setSavedId(id);
      if (thenPublish && !d.is_template) {
        await setEventStatus(supabase, id, "published");
        toast.success("Event published — members notified.");
      } else {
        toast.success(d.is_template ? "Template saved." : created ? "Draft saved." : "Changes saved.");
      }
      router.push(`/admin/events/${id}`);
      router.refresh();
    } catch (err) {
      const code = err instanceof Error && "code" in err ? String((err as { code: unknown }).code) : null;
      toast.error(code ? `Could not save the event (${code}).` : "Could not save the event. Please try again.");
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
      onSave={(d) => void save(d, false)}
      onCancel={() => router.push("/admin/events")}
    />
  );
}
