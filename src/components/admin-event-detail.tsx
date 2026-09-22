"use client";

/**
 * Admin event detail (§29): live fill counters, full lifecycle controls,
 * signup management (assign approved member / remove), realtime updates,
 * and the shared spreadsheet view.
 */
import { useCallback, useEffect, useMemo, useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { Badge, Button, ConfirmDialog, Modal } from "@/components/ui";
import { useToast } from "@/components/toast";
import { createBrowserClient } from "@/lib/supabase-browser";
import { EventSheet } from "@/components/event-sheet";
import {
  adminSetSignup,
  eventStats,
  fetchEvent,
  formatMassingTime,
  friendlyEventError,
  EventError,
  requirementLabel,
  setEventStatus,
  subscribeToEvent,
  type EventFull,
  type EventSlot,
} from "@/lib/events";

const STATUS_LABEL: Record<string, string> = {
  draft: "draft", published: "approved", locked: "locked",
  completed: "archived", cancelled: "rejected", archived: "archived",
};

interface MemberOption { id: string; ign: string }

export function AdminEventDetail({ eventId, initialEvent }: {
  eventId: string;
  initialEvent: EventFull | null;
}) {
  const router = useRouter();
  const toast = useToast();
  const supabase = createBrowserClient();
  const [event, setEvent] = useState<EventFull | null>(initialEvent);
  const [userId, setUserId] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [confirm, setConfirm] = useState<{ next: string } | null>(null);
  const [assignSlot, setAssignSlot] = useState<EventSlot | null>(null);
  const [members, setMembers] = useState<MemberOption[]>([]);
  const [assignUserId, setAssignUserId] = useState("");
  const [assignBusy, setAssignBusy] = useState(false);
  const [notFound, setNotFound] = useState(false);

  const reload = useCallback(async () => {
    try {
      const fresh = await fetchEvent(supabase, eventId);
      setEvent(fresh);
      setNotFound(!fresh);
    } catch {
      setNotFound(true);
    }
  }, [supabase, eventId]);

  useEffect(() => {
    let active = true;
    void (async () => {
      const { data } = await supabase.auth.getUser();
      if (active) setUserId(data.user?.id ?? null);
    })();
    return () => { active = false; };
  }, [supabase]);

  // Realtime: signups + status (§36).
  useEffect(() => {
    const off = subscribeToEvent(supabase, eventId, (kind) => {
      void reload();
      if (kind === "status") router.refresh();
    });
    return off;
  }, [supabase, eventId, reload, router]);

  const stats = useMemo(() => eventStats(event), [event]);

  const statusActions: Array<{ next: "published" | "locked" | "completed" | "cancelled" | "archived" | "draft"; label: string; danger?: boolean }> = [];
  if (event) {
    if (event.status === "draft") statusActions.push({ next: "published", label: "Publish" });
    if (event.status === "published") statusActions.push({ next: "locked", label: "Lock" });
    if (event.status === "locked") statusActions.push({ next: "published", label: "Unlock" });
    if (event.status === "published") statusActions.push({ next: "completed", label: "Complete" });
    if (event.status !== "archived" && event.status !== "cancelled") statusActions.push({ next: "cancelled", label: "Cancel event", danger: true });
    if (event.status === "completed") statusActions.push({ next: "archived", label: "Archive", danger: true });
  }

  const openAssign = async (slot: EventSlot) => {
    setAssignSlot(slot);
    setAssignUserId("");
    if (members.length === 0) {
      const { data } = await supabase
        .from("profiles")
        .select("id, ign")
        .eq("status", "approved")
        .order("ign")
        .limit(200);
      setMembers((data ?? []) as MemberOption[]);
    }
  };

  const confirmAssign = async () => {
    if (!assignSlot || !assignUserId) return;
    setAssignBusy(true);
    try {
      await adminSetSignup(supabase, assignSlot.id, assignUserId);
      toast.success("Signup saved.");
      setAssignSlot(null);
      await reload();
    } catch (err) {
      if (err instanceof EventError) {
        toast.error(friendlyEventError(err.code));
        return;
      }
      toast.error("Could not save the signup. Please try again.");
    } finally {
      setAssignBusy(false);
    }
  };

  if (notFound || !event) {
    return (
      <div className="panel mt-4 p-6 text-center">
        <p className="font-semibold text-ink">Event not found</p>
        <p className="mt-1 text-sm text-muted">It may have been deleted, or the link is wrong.</p>
        <Link href="/admin/events" className="btn btn-secondary mt-4">Back to Events</Link>
      </div>
    );
  }

  const when = formatMassingTime(event.event_date, event.massing_time, event.timezone);

  return (
    <div className="mt-1 space-y-5">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <div className="flex flex-wrap items-center gap-2">
            <h1 className="font-display text-2xl font-bold tracking-tight">{event.title}</h1>
            {event.is_template ? <span className="badge badge-role">Template</span> : <Badge status={STATUS_LABEL[event.status] ?? "neutral"} />}
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
        <div className="flex flex-wrap gap-2">
          <Link href={`/admin/events/${eventId}/edit`} className="btn btn-secondary">Edit structure</Link>
          {statusActions.map((a) => (
            <Button key={a.next} variant={a.danger ? "outline-danger" : "secondary"} onClick={() => setConfirm({ next: a.next })}>
              {a.label}
            </Button>
          ))}
        </div>
      </div>

      {/* Live stats (§29) */}
      <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
        <div className="panel p-4">
          <p className="section-title">Registered</p>
          <p className="mt-1 text-2xl font-bold">{stats.filled} / {stats.total}</p>
          <div className="mt-2 h-1.5 w-full overflow-hidden rounded-full bg-elevated">
            <div className="h-full rounded-full bg-brand transition-all" style={{ width: `${stats.total ? Math.round((stats.filled / stats.total) * 100) : 0}%` }} />
          </div>
        </div>
        <div className="panel p-4">
          <p className="section-title">Available slots</p>
          <p className="mt-1 text-2xl font-bold">{stats.open}</p>
        </div>
        {stats.perParty.slice(0, 2).map((p) => (
          <div key={p.partyId} className="panel p-4">
            <p className="section-title">{p.name}</p>
            <p className="mt-1 text-2xl font-bold">{p.filled} / {p.total}</p>
          </div>
        ))}
      </div>

      {event.instructions && (
        <div className="panel border-l-4 border-l-brand p-4">
          <p className="section-title">Instructions</p>
          <p className="mt-1 whitespace-pre-wrap text-sm text-muted">{event.instructions}</p>
        </div>
      )}

      <EventSheet
        event={event}
        currentUserId={userId}
        isAdmin
        editable={false}
        onAction={async (action) => {
          if (action.kind === "adminClear") {
            try {
              await adminSetSignup(supabase, action.slot.id, null);
              toast.success("Signup removed.");
              await reload();
            } catch {
              toast.error("Could not remove the signup. Please try again.");
            }
          } else if (action.kind === "claim" || action.kind === "leave") {
            void openAssign(action.slot);
          }
        }}
      />

      {/* Assign member modal */}
      <Modal open={assignSlot !== null} onClose={() => setAssignSlot(null)} title="Assign member to slot">
        {assignSlot && (
          <div className="space-y-3">
            <p className="text-sm text-muted">
              {assignSlot.role} · <span className="font-mono text-[13px]">{requirementLabel(assignSlot)}</span>
              {assignSlot.event_signups[0] && <> · currently: <strong>{assignSlot.event_signups[0].ign}</strong></>}
            </p>
            <div>
              <label htmlFor="assign-member" className="field-label">Approved member</label>
              <select id="assign-member" className="field" value={assignUserId} onChange={(e) => setAssignUserId(e.target.value)}>
                <option value="">Select member…</option>
                {members.map((m) => <option key={m.id} value={m.id}>{m.ign}</option>)}
              </select>
            </div>
            <div className="flex justify-end gap-2 pt-1">
              <Button variant="secondary" onClick={() => setAssignSlot(null)}>Cancel</Button>
              <Button loading={assignBusy} disabled={!assignUserId} onClick={() => void confirmAssign()}>Save signup</Button>
            </div>
          </div>
        )}
      </Modal>

      <ConfirmDialog
        open={confirm !== null}
        title={
          confirm?.next === "published" ? "Publish event?"
          : confirm?.next === "locked" ? "Lock event?"
          : confirm?.next === "completed" ? "Mark event completed?"
          : confirm?.next === "cancelled" ? "Cancel event?"
          : confirm?.next === "archived" ? "Archive event?"
          : "Restore to draft?"
        }
        body={
          confirm?.next === "published" ? "All approved members will be notified and can sign up immediately."
          : confirm?.next === "locked" ? "Members can still view the roster but cannot claim or change slots."
          : confirm?.next === "completed" ? "The roster becomes read-only for reference."
          : confirm?.next === "cancelled" ? "Members are told the event will not happen."
          : confirm?.next === "archived" ? "The event moves out of the active lists."
          : "The event becomes admin-only again until republished."
        }
        confirmLabel={
          confirm?.next === "published" ? "Publish"
          : confirm?.next === "locked" ? "Lock"
          : confirm?.next === "completed" ? "Complete"
          : confirm?.next === "cancelled" ? "Cancel event"
          : confirm?.next === "archived" ? "Archive"
          : "Restore"
        }
        danger={confirm?.next === "cancelled" || confirm?.next === "archived"}
        busy={busy}
        onCancel={() => setConfirm(null)}
        onConfirm={() => {
          if (!confirm) return;
          setBusy(true);
          void setEventStatus(supabase, eventId, confirm.next as EventFull["status"])
            .then(() => { toast.success("Status updated."); return reload(); })
            .catch((err) => {
              if (err instanceof EventError) toast.error(friendlyEventError(err.code));
              else toast.error("Could not update the status. Please try again.");
            })
            .finally(() => { setBusy(false); setConfirm(null); router.refresh(); });
        }}
      />
    </div>
  );
}
