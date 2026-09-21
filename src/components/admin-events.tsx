"use client";

/**
 * Admin events list (§28): event cards with live fill counters and the full
 * lifecycle controls — publish, lock, unlock, complete, cancel, archive,
 * duplicate. All actions call audited RPCs.
 */
import { useRouter } from "next/navigation";
import Link from "next/link";
import { useState } from "react";
import { Badge, Button, ConfirmDialog, EmptyState } from "@/components/ui";
import { useToast } from "@/components/toast";
import { createBrowserClient } from "@/lib/supabase-browser";
import { duplicateEvent, setEventStatus, type EventRow } from "@/lib/events";

const STATUS_LABEL: Record<string, string> = {
  draft: "draft", published: "approved", locked: "locked",
  completed: "archived", cancelled: "rejected", archived: "archived",
};

type Confirm =
  | { kind: "duplicate"; event: EventRow }
  | { kind: "status"; event: EventRow; next: "published" | "locked" | "completed" | "cancelled" | "archived" | "draft" }
  | null;

const CONFIRM_COPY: Record<string, { title: string; body: string; label: string; danger?: boolean }> = {
  published: { title: "Publish event?", body: "All approved members will be notified and can sign up immediately.", label: "Publish" },
  locked: { title: "Lock event?", body: "Members can still view the roster but cannot claim or change slots.", label: "Lock" },
  completed: { title: "Mark event completed?", body: "The roster becomes read-only for reference.", label: "Complete" },
  cancelled: { title: "Cancel event?", body: "Members are told the event will not happen.", label: "Cancel event", danger: true },
  archived: { title: "Archive event?", body: "The event moves out of the active lists.", label: "Archive", danger: true },
  draft: { title: "Restore to draft?", body: "The event becomes admin-only again until republished.", label: "Restore" },
};

export function AdminEvents({ events, fillCounts }: {
  events: EventRow[];
  fillCounts: Record<string, { filled: number; total: number }>;
}) {
  const router = useRouter();
  const toast = useToast();
  const supabase = createBrowserClient();
  const [busy, setBusy] = useState(false);
  const [confirm, setConfirm] = useState<Confirm>(null);

  const run = async (fn: () => Promise<void>) => {
    setBusy(true);
    try {
      await fn();
      toast.success("Done.");
      router.refresh();
    } catch (err) {
      const code = err instanceof Error && "code" in err ? String((err as { code: unknown }).code) : null;
      toast.error(code ? `Action failed (${code}).` : "Action failed. Please try again.");
    } finally {
      setBusy(false);
      setConfirm(null);
    }
  };

  return (
    <div className="space-y-3">
      {events.length === 0 ? (
        <EmptyState
          title="No events yet"
          description="Create your first mass: define parties, required builds, then publish for members to fill."
          action={<Link href="/admin/events/new" className="btn btn-primary">Create Event</Link>}
        />
      ) : (
        <div className="grid gap-3 md:grid-cols-2 xl:grid-cols-3">
          {events.map((event) => {
            const counts = fillCounts[event.id] ?? { filled: 0, total: 0 };
            return (
              <div key={event.id} className="panel flex flex-col p-4">
                <div className="flex items-start justify-between gap-2">
                  <div className="min-w-0">
                    <h3 className="truncate font-display text-base font-semibold">
                      <Link href={`/admin/events/${event.id}`} className="hover:underline">{event.title}</Link>
                    </h3>
                    <p className="mt-0.5 text-xs text-faint">
                      {[event.location, event.set_name].filter(Boolean).join(" · ") || "No location"}
                    </p>
                  </div>
                  {event.is_template
                    ? <span className="badge badge-role">Template</span>
                    : <Badge status={STATUS_LABEL[event.status] ?? "neutral"} />}
                </div>

                <dl className="mt-3 space-y-1 text-xs text-muted">
                  <div className="flex justify-between gap-2">
                    <dt>When</dt>
                    <dd className="truncate">{event.event_date ?? "TBA"}{event.massing_time ? ` · ${event.massing_time.slice(0, 5)} ${event.timezone}` : ""}</dd>
                  </div>
                  <div className="flex justify-between gap-2">
                    <dt>Caller</dt>
                    <dd className="truncate">{event.caller ?? "—"}</dd>
                  </div>
                </dl>

                <p className="mt-3 text-sm font-semibold">{counts.filled} / {counts.total} slots filled</p>
                <div className="mt-1 h-1.5 w-full overflow-hidden rounded-full bg-elevated">
                  <div
                    className="h-full rounded-full bg-brand transition-all"
                    style={{ width: counts.total ? `${Math.round((counts.filled / counts.total) * 100)}%` : "0%" }}
                    role="progressbar" aria-valuenow={counts.filled} aria-valuemin={0} aria-valuemax={counts.total}
                    aria-label={`Slots filled: ${counts.filled} of ${counts.total}`}
                  />
                </div>

                <div className="mt-4 flex flex-wrap gap-1 border-t border-line pt-3">
                  <Link href={`/admin/events/${event.id}`} className="btn btn-secondary btn-sm">Open</Link>
                  <Link href={`/admin/events/${event.id}/edit`} className="btn btn-secondary btn-sm">Edit</Link>
                  {event.status === "draft" && (
                    <Button size="sm" variant="primary" onClick={() => setConfirm({ kind: "status", event, next: "published" })}>Publish</Button>
                  )}
                  {event.status === "published" && (
                    <Button size="sm" variant="secondary" onClick={() => setConfirm({ kind: "status", event, next: "locked" })}>Lock</Button>
                  )}
                  {event.status === "locked" && (
                    <Button size="sm" variant="secondary" onClick={() => setConfirm({ kind: "status", event, next: "published" })}>Unlock</Button>
                  )}
                  <Button size="sm" variant="ghost" onClick={() => setConfirm({ kind: "duplicate", event })}>Duplicate</Button>
                  {event.status === "published" && (
                    <Button size="sm" variant="ghost" onClick={() => setConfirm({ kind: "status", event, next: "completed" })}>Complete</Button>
                  )}
                  {event.status !== "archived" && event.status !== "cancelled" && (
                    <Button size="sm" variant="outline-danger" onClick={() => setConfirm({ kind: "status", event, next: "cancelled" })}>Cancel</Button>
                  )}
                </div>
              </div>
            );
          })}
        </div>
      )}

      <ConfirmDialog
        open={confirm !== null}
        title={confirm?.kind === "duplicate" ? "Duplicate event?" : CONFIRM_COPY[confirm?.next ?? ""].title}
        body={
          confirm?.kind === "duplicate"
            ? `"${confirm.event.title}" will be copied with the same parties and slots but WITHOUT signups. The copy starts as a draft.`
            : confirm ? CONFIRM_COPY[confirm.next].body : ""
        }
        confirmLabel={confirm?.kind === "duplicate" ? "Duplicate" : confirm ? CONFIRM_COPY[confirm.next].label : "Confirm"}
        danger={confirm?.kind === "duplicate" ? false : CONFIRM_COPY[confirm?.next ?? ""].danger}
        busy={busy}
        onCancel={() => setConfirm(null)}
        onConfirm={() => {
          if (!confirm) return;
          if (confirm.kind === "duplicate") {
            void run(async () => {
              const id = await duplicateEvent(supabase, confirm.event.id);
              router.push(`/admin/events/${id}/edit`);
            });
          } else {
            void run(() => setEventStatus(supabase, confirm.event.id, confirm.next));
          }
        }}
      />
    </div>
  );
}
