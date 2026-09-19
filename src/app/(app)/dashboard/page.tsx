import Link from "next/link";
import { ClipboardList, Bell, ChevronRight, History } from "lucide-react";
import { requirePageSession } from "@/lib/api";
import { createSupabaseServerClient } from "@/lib/supabase-server";
import { createAdminClient, hasServiceRole } from "@/lib/supabase-admin";
import { Badge, EmptyState, StatCard } from "@/components/ui";
import { formatDateTime, timeAgo } from "@/lib/utils";

export const dynamic = "force-dynamic";
export const metadata = { title: "Dashboard" };

interface TeamCard {
  id: string;
  name: string;
  status: string;
  sheet_locked: boolean;
  description: string | null;
  member_count: number;
  my_role: string;
}

export default async function MemberDashboard() {
  const ctx = await requirePageSession();
  const supabase = await createSupabaseServerClient();

  // My team memberships (direct join; RLS limits team_members to visible rows).
  const { data: memberships } = await supabase
    .from("team_members")
    .select("id, team_id, role, teams(id, name, status, sheet_locked, description)")
    .eq("user_id", ctx.userId);

  const teams: TeamCard[] = [];
  for (const m of memberships ?? []) {
    const t = Array.isArray(m.teams) ? m.teams[0] : m.teams;
    if (!t || typeof t === "string") continue;
    const { count } = await supabase
      .from("team_members")
      .select("id", { count: "exact", head: true })
      .eq("team_id", (t as { id: string }).id);
    teams.push({
      id: (t as { id: string }).id,
      name: (t as { name: string }).name,
      status: (t as { status: string }).status,
      sheet_locked: (t as { sheet_locked: boolean }).sheet_locked,
      description: (t as { description: string | null }).description ?? null,
      member_count: count ?? 0,
      my_role: m.role,
    });
  }

  // Recent audit events about me (needs admin or falls back to RPC).
  let recentActivity: { id: string; action: string; created_at: string; meta: Record<string, unknown> }[] = [];
  if (hasServiceRole()) {
    const admin = createAdminClient();
    const { data } = await admin
      .from("audit_logs")
      .select("id, action, created_at, meta")
      .eq("actor_id", ctx.userId)
      .order("created_at", { ascending: false })
      .limit(6);
    recentActivity = data ?? [];
  } else {
    const { data } = await supabase
      .from("audit_logs")
      .select("id, action, created_at, meta")
      .eq("actor_id", ctx.userId)
      .order("created_at", { ascending: false })
      .limit(6);
    recentActivity = data ?? [];
  }

  const openTeams = teams.filter((t) => t.status === "open").length;

  return (
    <div className="mx-auto max-w-6xl space-y-6">
      <div>
        <h1 className="font-display text-2xl font-bold tracking-tight">
          Welcome back, {ctx.profile?.ign}
        </h1>
        <p className="mt-1 flex items-center gap-2 text-sm text-muted">
          Account: <Badge status={ctx.profile?.status ?? "approved"} />
          {ctx.isPlatformAdmin ? <span className="badge badge-admin">admin</span> : null}
        </p>
      </div>

      <div className="grid grid-cols-2 gap-3 sm:grid-cols-3">
        <StatCard label="Your teams" value={teams.length} />
        <StatCard label="Open sheets" value={openTeams} tone="success" />
        <StatCard
          label="Pending actions"
          value={teams.filter((t) => t.status === "open").length > 0 ? "Fill sheet" : "None"}
        />
      </div>

      <section>
        <div className="mb-3 flex items-center justify-between">
          <h2 className="section-title">Your teams</h2>
          <Link href="/teams" className="link-brand text-sm">All teams <ChevronRight className="inline" size={14} /></Link>
        </div>

        {teams.length === 0 ? (
          <EmptyState
            icon={<ClipboardList size={36} />}
            title="You haven't been assigned to a team yet"
            description="When an administrator adds you to a team, it will appear here and you'll get a notification."
          />
        ) : (
          <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
            {teams.map((team) => (
              <Link
                key={team.id}
                href={`/teams/${team.id}`}
                className="panel panel-hover block p-5 transition-colors"
              >
                <div className="flex items-center justify-between gap-2">
                  <h3 className="font-display text-base font-semibold">{team.name}</h3>
                  <Badge status={team.status} />
                </div>
                <p className="mt-1 line-clamp-1 text-xs text-faint">{team.description || "No description"}</p>
                <div className="mt-4 flex items-center justify-between text-sm">
                  <span className="text-muted">{team.member_count} members</span>
                  <span className="badge badge-role">{team.my_role}</span>
                </div>
                <div className="mt-3">
                  {team.sheet_locked ? (
                    <span className="text-xs font-semibold text-danger">🔒 Sheet locked — view only</span>
                  ) : (
                    <span className="text-xs font-semibold text-success">Sheet open — you can edit</span>
                  )}
                </div>
              </Link>
            ))}
          </div>
        )}
      </section>

      <section className="grid gap-6 lg:grid-cols-2">
        <div className="panel p-5">
          <div className="mb-3 flex items-center justify-between">
            <h2 className="section-title">Recent activity</h2>
            <History size={15} className="text-faint" />
          </div>
          {recentActivity.length === 0 ? (
            <p className="py-6 text-center text-sm text-muted">No activity yet.</p>
          ) : (
            <ul className="divide-y divide-line">
              {recentActivity.map((a) => (
                <li key={a.id} className="flex items-center justify-between gap-3 py-2.5 text-sm">
                  <span className="min-w-0 truncate text-ink">{describeActivity(a.action, a.meta)}</span>
                  <span className="shrink-0 text-xs text-faint">{timeAgo(a.created_at)}</span>
                </li>
              ))}
            </ul>
          )}
        </div>

        <div className="panel p-5">
          <div className="mb-3 flex items-center justify-between">
            <h2 className="section-title">Notifications</h2>
            <Bell size={15} className="text-faint" />
          </div>
          <p className="py-6 text-center text-sm text-muted">
            Your latest notifications appear in the bell menu.
          </p>
          <Link href="/notifications" className="btn btn-secondary btn-sm w-full">
            Open notifications
          </Link>
        </div>
      </section>
    </div>
  );
}

function describeActivity(action: string, meta: Record<string, unknown>): string {
  switch (action) {
    case "USER_LOGIN": return "Signed in";
    case "USER_REGISTERED": return "Registered an account";
    case "FIELD_UPDATED":
      return `Updated ${String(meta.field ?? "field")}${
        meta.previous ? `: ${String(meta.previous)} → ${String(meta.new)}` : ""
      }`;
    case "MEMBER_ADDED": return `Added to ${String(meta.team_name ?? "a team")}`;
    case "MEMBER_REMOVED": return `Removed from ${String(meta.team_name ?? "a team")}`;
    default: return action.replaceAll("_", " ").toLowerCase();
  }
}
