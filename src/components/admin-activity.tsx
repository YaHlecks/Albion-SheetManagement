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
  teams: { name: string } | { name: string }[] | null;
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
  TEAM_CREATED: { label: "Team created", tone: "badge-draft" },
  TEAM_RENAMED: { label: "Team renamed", tone: "badge-neutral" },
  TEAM_ARCHIVED: { label: "Team archived", tone: "badge-archived" },
  TEAM_OPENED: { label: "Team opened", tone: "badge-open" },
  MEMBER_ADDED: { label: "Member added", tone: "badge-approved" },
  MEMBER_REMOVED: { label: "Member removed", tone: "badge-rejected" },
  SHEET_LOCKED: { label: "Sheet locked", tone: "badge-locked" },
  SHEET_UNLOCKED: { label: "Sheet unlocked", tone: "badge-open" },
  FIELD_UPDATED: { label: "Field updated", tone: "badge-pending" },
  CHANGE_REVERTED: { label: "Change reverted", tone: "badge-draft" },
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
  teams,
}: {
  events: ActivityEvent[];
  total: number;
  page: number;
  pageSize: number;
  filters: { q: string; action: string; team: string };
  teams: { id: string; name: string }[];
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
        <select className="field lg:w-48" value={filters.team} onChange={(e) => update({ team: e.target.value })} aria-label="Filter by team">
          <option value="">All teams</option>
          {teams.map((t) => (
            <option key={t.id} value={t.id}>{t.name}</option>
          ))}
        </select>
        <p className="text-xs text-faint lg:ml-auto">{total} events</p>
      </div>

      <div className="panel divide-y divide-line overflow-hidden">
        {events.map((ev) => {
          const actor = first(ev.profiles)?.ign ?? "System";
          const target = first(ev.target)?.ign;
          const team = first(ev.teams)?.name;
          const label = ACTION_LABELS[ev.action] ?? { label: ev.action, tone: "badge-neutral" };
          const isOpen = expanded === ev.id;
          const hasDetail = ev.action === "FIELD_UPDATED" || ev.action === "CHANGE_REVERTED" ||
            ev.action === "TEAM_RENAMED" || Boolean(ev.meta && Object.keys(ev.meta).length > 0);

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
                  {team ? <span className="text-faint"> · {team}</span> : null}
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

  if (ev.action === "FIELD_UPDATED" || ev.action === "CHANGE_REVERTED") {
    rows.push(["Field", String(meta.field ?? "—")]);
    rows.push(["Previous value", meta.previous ? String(meta.previous) : "(empty)"]);
    if (ev.action === "CHANGE_REVERTED") {
      rows.push(["Restored to", meta.reverted_to ? String(meta.reverted_to) : "(empty)"]);
    } else {
      rows.push(["New value", meta.new ? String(meta.new) : "(empty)"]);
    }
  }
  if (meta.team_name) rows.push(["Team", String(meta.team_name)]);
  if (meta.role) rows.push(["Role", String(meta.role)]);
  if (meta.previous_status) rows.push(["Previous status", String(meta.previous_status)]);
  if (meta.new_status) rows.push(["New status", String(meta.new_status)]);
  if (meta.previous && meta.new) rows.push(["Change", `${String(meta.previous)} → ${String(meta.new)}`]);
  if (meta.admin_action) rows.push(["Admin action", String(meta.admin_action)]);
  rows.push(["Event ID", ev.id]);

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
