import Link from "next/link";
import { ChevronRight, Inbox, ShieldCheck } from "lucide-react";
import { requireAdminPage } from "@/lib/api";
import { createSupabaseServerClient } from "@/lib/supabase-server";
import { createAdminClient, hasServiceRole } from "@/lib/supabase-admin";
import { Badge, EmptyState, StatCard } from "@/components/ui";
import { formatDateTime, timeAgo } from "@/lib/utils";

export const dynamic = "force-dynamic";
export const metadata = { title: "Admin Dashboard" };

export default async function AdminDashboard() {
  const supabase = await createSupabaseServerClient();

  const { count: totalUsers } = await supabase
    .from("profiles")
    .select("id", { count: "exact", head: true });
  const { count: pendingUsers } = await supabase
    .from("profiles")
    .select("id", { count: "exact", head: true })
    .eq("status", "pending");
  const { count: activeTeams } = await supabase
    .from("teams")
    .select("id", { count: "exact", head: true })
    .in("status", ["open", "draft", "locked"]);
  const { count: totalChanges } = await supabase
    .from("audit_logs")
    .select("id", { count: "exact", head: true });

  const { data: pending } = await supabase
    .from("profiles")
    .select("id, ign, discord, created_at")
    .eq("status", "pending")
    .order("created_at", { ascending: true })
    .limit(5);

  const { data: recent } = await supabase
    .from("audit_logs")
    .select("id, action, created_at, actor_id, target_user_id, team_id, meta, profiles:actor_id(ign), teams(name)")
    .order("created_at", { ascending: false })
    .limit(8);

  const { data: teams } = await supabase
    .from("teams")
    .select("id, name, status, sheet_locked")
    .in("status", ["open", "draft", "locked"])
    .order("created_at", { ascending: false })
    .limit(5);

  const teamCounts = new Map<string, number>();
  const { data: counts } = await supabase.from("team_members").select("team_id");
  for (const c of counts ?? []) {
    teamCounts.set(c.team_id, (teamCounts.get(c.team_id) ?? 0) + 1);
  }

  return (
    <div className="mx-auto max-w-6xl space-y-6">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <h1 className="font-display text-2xl font-bold tracking-tight">Admin Dashboard</h1>
          <p className="mt-1 text-sm text-muted">System overview and pending actions.</p>
        </div>
        <Link href="/admin/approvals" className="btn btn-primary btn-sm gap-1.5">
          <ShieldCheck size={15} /> Review approvals ({pendingUsers ?? 0})
        </Link>
      </div>

      <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
        <StatCard label="Total users" value={totalUsers ?? 0} href="/admin/accounts" />
        <StatCard label="Pending approvals" value={pendingUsers ?? 0} tone="warn" href="/admin/approvals" />
        <StatCard label="Active teams" value={activeTeams ?? 0} href="/admin/teams" />
        <StatCard label="Recorded events" value={totalChanges ?? 0} hint="audit entries" href="/admin/activity" />
      </div>

      <div className="grid gap-6 lg:grid-cols-2">
        {/* Pending approvals */}
        <section className="panel p-5">
          <div className="mb-3 flex items-center justify-between">
            <h2 className="section-title">Pending approvals</h2>
            <Inbox size={15} className="text-faint" />
          </div>
          {!pending || pending.length === 0 ? (
            <p className="py-6 text-center text-sm text-muted">No pending registrations. All clear.</p>
          ) : (
            <ul className="divide-y divide-line">
              {pending.map((p) => (
                <li key={p.id} className="flex items-center justify-between gap-3 py-2.5">
                  <div className="min-w-0">
                    <p className="truncate text-sm font-semibold">{p.ign}</p>
                    <p className="text-xs text-faint">Registered {formatDateTime(p.created_at)}</p>
                  </div>
                  <Link href={`/admin/accounts/${p.id}`} className="btn btn-secondary btn-sm shrink-0">
                    Review
                  </Link>
                </li>
              ))}
            </ul>
          )}
          {pending && pending.length > 0 ? (
            <Link href="/admin/approvals" className="mt-3 inline-flex items-center gap-1 text-sm text-brand hover:underline">
              All approvals <ChevronRight size={14} />
            </Link>
          ) : null}
        </section>

        {/* Active teams */}
        <section className="panel p-5">
          <div className="mb-3 flex items-center justify-between">
            <h2 className="section-title">Active teams</h2>
          </div>
          {!teams || teams.length === 0 ? (
            <p className="py-6 text-center text-sm text-muted">No active teams yet. Create one in Teams.</p>
          ) : (
            <ul className="divide-y divide-line">
              {teams.map((t) => (
                <li key={t.id} className="flex items-center justify-between gap-3 py-2.5">
                  <div className="min-w-0">
                    <p className="truncate text-sm font-semibold">{t.name}</p>
                    <p className="text-xs text-faint">{teamCounts.get(t.id) ?? 0} members</p>
                  </div>
                  <Badge status={t.status} />
                </li>
              ))}
            </ul>
          )}
          <Link href="/admin/teams" className="mt-3 inline-flex items-center gap-1 text-sm text-brand hover:underline">
            Manage teams <ChevronRight size={14} />
          </Link>
        </section>
      </div>

      {/* Recent activity */}
      <section className="panel p-5">
        <div className="mb-3 flex items-center justify-between">
          <h2 className="section-title">Recent activity</h2>
          <Link href="/admin/activity" className="link-brand text-sm">Full activity log</Link>
        </div>
        {!recent || recent.length === 0 ? (
          <p className="py-6 text-center text-sm text-muted">No recorded activity yet.</p>
        ) : (
          <ul className="divide-y divide-line">
            {recent.map((r) => {
              const actor = Array.isArray(r.profiles) ? r.profiles[0] : r.profiles;
              const team = Array.isArray(r.teams) ? r.teams[0] : r.teams;
              return (
                <li key={r.id} className="flex items-center justify-between gap-3 py-2.5 text-sm">
                  <span className="min-w-0 truncate">
                    <span className="font-semibold">{typeof actor === "object" && actor ? (actor as { ign: string }).ign : "System"}</span>{" "}
                    <span className="text-muted">{describeAction(r.action, r.meta)}</span>
                    {typeof team === "object" && team ? <span className="text-faint"> · {((team as { name: string }).name)}</span> : null}
                  </span>
                  <span className="shrink-0 text-xs text-faint">{timeAgo(r.created_at)}</span>
                </li>
              );
            })}
          </ul>
        )}
      </section>
    </div>
  );
}

function describeAction(action: string, meta: Record<string, unknown>): string {
  switch (action) {
    case "USER_REGISTERED": return "registered an account";
    case "USER_APPROVED": return "was approved";
    case "USER_REJECTED": return "was rejected";
    case "USER_SUSPENDED": return "was suspended";
    case "USER_REACTIVATED": return "was reactivated";
    case "USER_ARCHIVED": return "was archived";
    case "USER_LOGIN": return "signed in";
    case "USER_LOGOUT": return "signed out";
    case "TEAM_CREATED": return `created team ${String(meta.name ?? "")}`.trim();
    case "TEAM_RENAMED": return `renamed team: ${String(meta.previous ?? "")} → ${String(meta.new ?? "")}`;
    case "TEAM_ARCHIVED": return "archived a team";
    case "TEAM_OPENED": return "opened a team";
    case "MEMBER_ADDED": return "was added to a team";
    case "MEMBER_REMOVED": return "was removed from a team";
    case "SHEET_LOCKED": return "locked a sheet";
    case "SHEET_UNLOCKED": return "unlocked a sheet";
    case "FIELD_UPDATED": {
      const field = String(meta.field ?? "field");
      const prev = meta.previous ? String(meta.previous) : "empty";
      const next = meta.new ? String(meta.new) : "empty";
      return `updated ${field}: ${prev} → ${next}`;
    }
    case "CHANGE_REVERTED": return `reverted ${String(meta.field ?? "a field")}`;
    default: return action.toLowerCase().replaceAll("_", " ");
  }
}
