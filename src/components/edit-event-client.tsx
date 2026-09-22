"use client";

/**
 * Edit-event client: hydrates the builder from the loaded event and saves
 * the whole structure with one atomic RPC (signups on untouched slots are
 * preserved by save_event; deletions cascade with a UI warning).
 */
import { useState } from "react";
import { useRouter } from "next/navigation";
import { useToast } from "@/components/toast";
import { createBrowserClient } from "@/lib/supabase-browser";
import { EventBuilder } from "@/components/event-builder";
import { saveEvent, setEventStatus, technicalDetail, type EventDraft, type SlotPriority } from "@/lib/events";

// eslint-disable-next-line @typescript-eslint/no-explicit-any
export function EditEventClient({ eventId, event }: { eventId: string; event: any }) {
  const router = useRouter();
  const toast = useToast();
  const supabase = createBrowserClient();
  const [draft, setDraft] = useState<EventDraft>(() => draftFrom(event));
  const [busy, setBusy] = useState(false);

  const save = async (d: EventDraft, thenPublish: boolean) => {
    setBusy(true);
    try {
      await saveEvent(supabase, eventId, d);
      if (thenPublish) {
        await setEventStatus(supabase, eventId, "published");
        toast.success("Event published — members notified.");
      } else {
        toast.success("Changes saved.");
      }
      router.push(`/admin/events/${eventId}`);
      router.refresh();
    } catch (err) {
      console.error("[edit-event] save failed:", err);
      toast.error(`Unable to save the event. Technical error: ${technicalDetail(err)}`);
      // No navigation: the edit stays open with all work intact (§32).
    } finally {
      setBusy(false);
    }
  };

  return (
    <EventBuilder
      draft={draft}
      onChange={setDraft}
      busy={busy}
      saveLabel="Save changes"
      onSave={(d, publish) => void save(d, publish)}
      onCancel={() => router.push(`/admin/events/${eventId}`)}
    />
  );
}

function draftFrom(event: {
  title: string; description: string | null; event_date: string | null; massing_time: string | null;
  timezone: string; location: string | null; portal: string | null; set_name: string | null;
  caller: string | null; instructions: string | null; is_template: boolean;
  event_parties: Array<{
    id: string; name: string; fill_note: string | null; sort_order: number;
    event_slots: Array<{
      id: string; role: string; notes: string | null; priority: string; required: boolean; sort_order: number;
      event_slot_requirements: Array<{ id: string; category: string; item: string; tier_requirement: string; sort_order: number }>;
      event_signups: Array<{ ign: string }>;
    }>;
  }>;
}): EventDraft {
  return {
    title: event.title,
    description: event.description ?? "",
    event_date: event.event_date ?? "",
    massing_time: (event.massing_time ?? "").slice(0, 5),
    timezone: event.timezone || "UTC",
    location: event.location ?? "",
    portal: event.portal ?? "",
    set_name: event.set_name ?? "",
    caller: event.caller ?? "",
    instructions: event.instructions ?? "",
    is_template: event.is_template,
    parties: event.event_parties.map((p) => ({
      id: p.id,
      name: p.name,
      fill_note: p.fill_note ?? "",
      slots: p.event_slots.map((s) => ({
        id: s.id,
        role: s.role,
        notes: s.notes ?? "",
        priority: s.priority as SlotPriority,
        required: s.required,
        requirements: (s.event_slot_requirements ?? [])
          .slice()
          .sort((a, b) => a.sort_order - b.sort_order)
          .map((r) => ({
            id: r.id,
            category: r.category,
            item: r.item,
            tier_requirement: r.tier_requirement || "any",
          })),
        assignedIgn: s.event_signups[0]?.ign ?? null,
      })),
    })),
  };
}
