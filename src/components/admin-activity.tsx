"use client";

import { useState } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import { ChevronDown } from "lucide-react";
import { Pagination, SearchInput } from "@/components/ui";
import { formatDateTime } from "@/lib/utils";

export interface ActivityEvent {
  id: string;
  action: string;
  meta: Record<string, unknown>;
  created_at: string;
  actor_id: string | null;
  target_user_id: string | null;
  profiles: { ign: string } | { ign: string }[] | null;
  target: { ign: string } | { ign: string }[] | null;
}

const ACTION_LABELS: Record<string, { label: string; tone: string }> = {
  USER_REGISTERED: { label: "Registered", tone: "badge-neutral" },
  USER_APPROVED: { label: "Approved", tone: "badge-approved" },
  USER_REJECTED: { label: "Rejected", tone: "badge-rejected" },
  USER_SUSPENDED: { label: "Suspended", tone: "badge-suspended" },
  USER_REACTIVATED: { label: "Reactivated", tone: "badge-approved" },
  USER_ARCHIVED: { label: "Archived", tone: "badge-archived" },
  USER_LOGIN: { label: "Signed in", tone: "badge-neutral" },
  USER_LOGOUT: { label: "Signed out", tone: "badge-neutral" },
  EVENT_CREATED: { label: "Event created", tone: "badge-draft" },
  EVENT_UPDATED: { label: "Event updated", tone: "badge-pending" },
  EVENT_PUBLISHED: { label: "Event published", tone: "badge-approved" },
  EVENT_LOCKED: { label: "Event locked", tone: "badge-locked" },
  EVENT_COMPLETED: { label: "Event completed", tone: "badge-archived" },
  EVENT_CANCELLED: { label: "Event cancelled", tone: "badge-rejected" },
  EVENT_ARCHIVED: { label: "Event archived", tone: "badge-archived" },
  EVENT_RESTORED: { label: "Event restored", tone: "badge-open" },
  EVENT_DUPLICATED: { label: "Event duplicated", tone: "badge-neutral" },
  SIGNUP_CREATED: { label: "Signed up", tone: "badge-approved" },
  SIGNUP_REMOVED: { label: "Signup removed", tone: "badge-rejected" },
  SIGNUP_MOVED: { label: "Signup moved", tone: "badge-pending" },
  PERMISSION_CHANGED: { label: "Permissions changed", tone: "badge-admin" },
};

const ACTION_OPTIONS = Object.keys(ACTION_LABELS);

function first<T>(v: T | T[] | null | undefined): T | null {
  if (!v) return null;
  return Array.isArray(v) ? v[0] ?? null : v;
}

export function ActivityViewer({
  events,
  total,
  page,
  pageSize,
  filters,
}: {
  events: ActivityEvent[];
  total: number;
  page: number;
  pageSize: number;
  filters: { q: string; action: string };
}) {
  const router = useRouter();
  const params = useSearchParams();
  const [expanded, setExpanded] = useState<string | null>(null);

  function update(patch: Record<string, string>) {
    const next = new URLSearchParams(params.toString());
    for (const [k, v] of Object.entries(patch)) {
      if (v) next.set(k, v);
      else next.delete(k);
    }
    if (!("page" in patch)) next.delete("page");
    router.replace(`/admin/activity?${next.toString()}`);
  }

  const pageCount = Math.max(1, Math.ceil(total / pageSize));

  return (
    <div className="space-y-4">
      <div className="flex flex-col gap-3 lg:flex-row lg:items-center">
        <SearchInput
          value={filters.q}
          onChange={(v) => update({ q: v })}
          placeholder="Search activity…"
          className="lg:max-w-xs"
        />
        <select className="field lg:w-56" value={filters.action} onChange={(e) => update({ action: e.target.value })} aria-label="Filter by action">
          <option value="">All actions</option>
          {ACTION_OPTIONS.map((a) => (
            <option key={a} value={a}>{ACTION_LABELS[a]?.label ?? a}</option>
          ))}
        </select>
        <p className="text-xs text-faint lg:ml-auto">{total} entries</p>
      </div>

      <div className="panel divide-y divide-line overflow-hidden">
        {events.map((ev) => {
          const actor = first(ev.profiles)?.ign ?? "System";
          const target = first(ev.target)?.ign;
          const label = ACTION_LABELS[ev.action] ?? { label: ev.action, tone: "badge-neutral" };
          const isOpen = expanded === ev.id;
          const hasDetail = Boolean(ev.meta && Object.keys(ev.meta).length > 0);

          return (
            <div key={ev.id}>
              <button
                type="button"
                className="flex w-full items-center gap-3 px-4 py-3 text-left hover:bg-white/[0.015]"
                onClick={() => setExpanded(isOpen ? null : ev.id)}
                aria-expanded={isOpen}
              >
                <span className={`badge ${label.tone} shrink-0`}>{label.label}</span>
                <span className="min-w-0 flex-1 text-sm">
                  <span className="font-semibold text-ink">{actor}</span>
                  {target && target !== actor ? <span className="text-muted"> → {target}</span> : null}
                </span>
                <span className="shrink-0 text-xs text-faint">{formatDateTime(ev.created_at)}</span>
                {hasDetail ? <ChevronDown size={14} className={isOpen ? "rotate-180 text-faint" : "text-faint"} /> : null}
              </button>

              {isOpen ? (
                <div className="border-t border-line bg-surface/60 px-4 py-3">
                  <EventDetail ev={ev} />
                </div>
              ) : null}
            </div>
          );
        })}
      </div>

      <Pagination page={page} pageCount={pageCount} onPage={(p) => update({ page: String(p) })} />
    </div>
  );
}

function EventDetail({ ev }: { ev: ActivityEvent }) {
  const rows: [string, string][] = [];
  const meta = ev.meta ?? {};

  if (meta.slot_id) rows.push(["Slot", String(meta.slot_id)]);
  if (meta.ign) rows.push(["IGN", String(meta.ign)]);
  if (meta.role) rows.push(["Role", String(meta.role)]);
  if (meta.title) rows.push(["Event", String(meta.title)]);
  if (meta.previous_status) rows.push(["Previous status", String(meta.previous_status)]);
  if (meta.new_status) rows.push(["New status", String(meta.new_status)]);
  if (meta.previous_slot) rows.push(["Previous slot", String(meta.previous_slot)]);
  if (meta.by) rows.push(["By", String(meta.by)]);
  if (meta.admin_action) rows.push(["Admin action", String(meta.admin_action)]);
  rows.push(["Entry ID", ev.id]);

  return (
    <dl className="desc-list grid gap-x-8 gap-y-3 sm:grid-cols-2">
      {rows.map(([k, v]) => (
        <div key={k}>
          <dt>{k}</dt>
          <dd className="break-words">{v}</dd>
        </div>
      ))}
    </dl>
  );
}
