"use client";

/**
 * Member event experience (§14/§11/§36): mass-sheet header, instructions,
 * live fill stats, realtime updates, claim/leave via the signup RPCs.
 */
import { useCallback, useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { Badge } from "@/components/ui";
import { useToast } from "@/components/toast";
import { createBrowserClient } from "@/lib/supabase-browser";
import { EventSheet } from "@/components/event-sheet";
import {
  claimEventSlot,
  eventStats,
  fetchEvent,
  friendlyEventError,
  EventError,
  formatMassingTime,
  leaveEventSlot,
  subscribeToEvent,
  type EventFull,
} from "@/lib/events";

const STATUS_LABEL: Record<string, string> = {
  published: "approved", locked: "locked", completed: "archived",
  draft: "draft", cancelled: "rejected",
};

export function MemberEventView({ eventId, initialEvent, userId }: {
  eventId: string;
  initialEvent: EventFull;
  userId: string;
}) {
  const router = useRouter();
  const toast = useToast();
  const supabase = createBrowserClient();
  const [event, setEvent] = useState<EventFull>(initialEvent);
  const [reloadError, setReloadError] = useState(false);

  const reload = useCallback(async () => {
    try {
      const fresh = await fetchEvent(supabase, eventId);
      if (fresh) setEvent(fresh);
    } catch {
      setReloadError(true);
    }
  }, [supabase, eventId]);

  // One realtime channel per event, cleaned up on unmount (§36).
  useEffect(() => {
    const off = subscribeToEvent(supabase, eventId, () => {
      void reload();
    });
    return off;
  }, [supabase, eventId, reload]);

  const stats = eventStats(event);
  const editable = event.status === "published";
  const when = formatMassingTime(event.event_date, event.massing_time, event.timezone);

  const onAction = async (action: { kind: string; slot: { id: string }; note?: string }) => {
    if (action.kind === "claim") {
      try {
        await claimEventSlot(supabase, action.slot.id, action.note);
        toast.success("Slot claimed — your IGN is on the sheet.");
      } catch (err) {
        if (err instanceof EventError) {
          toast.error(friendlyEventError(err.code));
          return;
        }
        toast.error("Could not claim the slot. Please try again.");
        return;
      }
    } else if (action.kind === "leave") {
      try {
        await leaveEventSlot(supabase, action.slot.id);
        toast.success("Slot released.");
      } catch (err) {
        if (err instanceof EventError) {
          toast.error(friendlyEventError(err.code));
          return;
        }
        toast.error("Could not release the slot. Please try again.");
        return;
      }
    } else {
      return;
    }
    await reload();
  };

  return (
    <div className="mt-1 space-y-5">
      {/* Mass-sheet header (§14) */}
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <div className="flex flex-wrap items-center gap-2">
            <h1 className="font-display text-2xl font-bold tracking-tight">{event.title}</h1>
            <Badge status={STATUS_LABEL[event.status] ?? "neutral"} />
          </div>
          <p className="mt-1 text-sm text-muted">
            {[
              event.location && `MASS LOCATION: ${event.location}`,
              event.set_name && `SET: ${event.set_name}`,
              `MASSING TIME: ${when}`,
              event.caller && `CALLER: ${event.caller}`,
            ].filter(Boolean).join("  ·  ")}
          </p>
        </div>
        <div className="panel px-4 py-3 text-right">
          <p className="section-title">Slots filled</p>
          <p className="text-xl font-bold">{stats.filled} / {stats.total}</p>
          <p className="text-xs text-faint">{stats.open} open</p>
        </div>
      </div>

      {event.description && <p className="panel p-4 text-sm text-muted">{event.description}</p>}
      {event.instructions && (
        <div className="panel border-l-4 border-l-brand p-4">
          <p className="section-title">Instructions</p>
          <p className="mt-1 whitespace-pre-wrap text-sm text-muted">{event.instructions}</p>
        </div>
      )}

      {event.status === "locked" && (
        <p className="panel p-3 text-sm text-warn" role="status">
          This event is locked — the roster is final. You can still view it.
        </p>
      )}
      {event.status === "completed" && (
        <p className="panel p-3 text-sm text-muted" role="status">
          This event has been completed — view only.
        </p>
      )}
      {reloadError && (
        <p className="panel p-3 text-sm text-warn" role="status">
          Live updates were interrupted — refresh the page for the latest signups.
        </p>
      )}

      <EventSheet
        event={event}
        currentUserId={userId}
        isAdmin={false}
        editable={editable}
        onAction={onAction}
      />
    </div>
  );
}
