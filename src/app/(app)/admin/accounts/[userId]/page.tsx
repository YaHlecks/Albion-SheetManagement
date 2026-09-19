import Link from "next/link";
import { notFound } from "next/navigation";
import { ArrowLeft } from "lucide-react";
import { requireAdminPage } from "@/lib/api";
import { createSupabaseServerClient } from "@/lib/supabase-server";
import { createAdminClient, hasServiceRole } from "@/lib/supabase-admin";
import { AccountActions } from "@/components/admin-account-actions";
import { Badge } from "@/components/ui";
import { formatDateTime, timeAgo } from "@/lib/utils";

export const dynamic = "force-dynamic";

export default async function AdminAccountDetailPage({
  params,
}: {
  params: Promise<{ userId: string }>;
}) {
  const { userId } = await params;
  await requireAdminPage();

  const supabase = hasServiceRole() ? createAdminClient() : await createSupabaseServerClient();

  const { data: account } = await supabase
    .from("profiles")
    .select("id, ign, discord, status, is_platform_admin, created_at, last_login_at, approved_at, suspended_at")
    .eq("id", userId)
    .maybeSingle();

  if (!account) notFound();

  const { data: memberships } = await supabase
    .from("team_members")
    .select("id, role, joined_at, teams(id, name, status)")
    .eq("user_id", userId);

  const { data: activity } = await supabase
    .from("audit_logs")
    .select("id, action, meta, created_at, teams(name)")
    .eq("actor_id", userId)
    .order("created_at", { ascending: false })
    .limit(10);

  const teams = (memberships ?? [])
    .map((m) => {
      const t = Array.isArray(m.teams) ? m.teams[0] : m.teams;
      if (!t || typeof t === "string") return null;
      return { membershipId: m.id, role: m.role, joinedAt: m.joined_at, id: (t as { id: string }).id, name: (t as { name: string }).name, status: (t as { status: string }).status };
    })
    .filter((t): t is NonNullable<typeof t> => t !== null);

  return (
    <div className="mx-auto max-w-4xl space-y-5">
      <div>
        <Link href="/admin/accounts" className="inline-flex items-center gap-1.5 text-sm text-muted hover:text-ink">
          <ArrowLeft size={15} /> Members
        </Link>
      </div>

      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <div className="flex items-center gap-3">
            <h1 className="font-display text-2xl font-bold tracking-tight">{account.ign}</h1>
            <Badge status={account.status} />
            {account.is_platform_admin ? <span className="badge badge-admin">admin</span> : null}
          </div>
          <p className="mt-1 text-sm text-muted">{account.discord ? `Discord: ${account.discord}` : "No Discord set"}</p>
        </div>
        <AccountActions
          account={{
            id: account.id,
            ign: account.ign,
            status: account.status,
            isPlatformAdmin: account.is_platform_admin,
          }}
        />
      </div>

      <section className="panel p-5">
        <h2 className="section-title mb-4">Account information</h2>
        <dl className="desc-list grid gap-4 sm:grid-cols-3">
          <div><dt>IGN</dt><dd>{account.ign}</dd></div>
          <div><dt>Status</dt><dd className="capitalize">{account.status}</dd></div>
          <div><dt>Registered</dt><dd>{formatDateTime(account.created_at)}</dd></div>
          <div><dt>Last login</dt><dd>{account.last_login_at ? formatDateTime(account.last_login_at) : "Never"}</dd></div>
          <div><dt>Approved at</dt><dd>{account.approved_at ? formatDateTime(account.approved_at) : "—"}</dd></div>
          <div><dt>Suspended at</dt><dd>{account.suspended_at ? formatDateTime(account.suspended_at) : "—"}</dd></div>
        </dl>
      </section>

      <section className="panel p-5">
        <h2 className="section-title mb-4">Team memberships</h2>
        {teams.length === 0 ? (
          <p className="py-4 text-center text-sm text-muted">Not assigned to any team.</p>
        ) : (
          <ul className="divide-y divide-line">
            {teams.map((t) => (
              <li key={t.membershipId} className="flex items-center justify-between py-2.5 text-sm">
                <Link href={`/admin/teams/${t.id}`} className="font-semibold text-brand hover:underline">{t.name}</Link>
                <span className="flex items-center gap-2">
                  <span className="badge badge-role">{t.role}</span>
                  <Badge status={t.status} />
                </span>
              </li>
            ))}
          </ul>
        )}
      </section>

      <section className="panel p-5">
        <h2 className="section-title mb-4">Recent activity</h2>
        {!activity || activity.length === 0 ? (
          <p className="py-4 text-center text-sm text-muted">No recorded activity.</p>
        ) : (
          <ul className="divide-y divide-line">
            {activity.map((a) => {
              const team = Array.isArray(a.teams) ? a.teams[0] : a.teams;
              return (
                <li key={a.id} className="flex items-center justify-between gap-3 py-2.5 text-sm">
                  <span className="min-w-0 truncate">
                    {describeUserAction(a.action, a.meta)}
                    {typeof team === "object" && team ? <span className="text-faint"> · {(team as { name: string }).name}</span> : null}
                  </span>
                  <span className="shrink-0 text-xs text-faint">{timeAgo(a.created_at)}</span>
                </li>
              );
            })}
          </ul>
        )}
      </section>
    </div>
  );
}

function describeUserAction(action: string, meta: Record<string, unknown>): string {
  switch (action) {
    case "USER_LOGIN": return "Signed in";
    case "USER_LOGOUT": return "Signed out";
    case "USER_REGISTERED": return "Registered an account";
    case "FIELD_UPDATED": {
      const field = String(meta.field ?? "field");
      const prev = meta.previous ? String(meta.previous) : "empty";
      const next = meta.new ? String(meta.new) : "empty";
      return `Updated ${field}: ${prev} → ${next}`;
    }
    case "MEMBER_ADDED": return `Added to ${String(meta.team_name ?? "team")}`;
    case "MEMBER_REMOVED": return `Removed from ${String(meta.team_name ?? "team")}`;
    case "CHANGE_REVERTED": return `Reverted ${String(meta.field ?? "a field")}`;
    default: return action.toLowerCase().replaceAll("_", " ");
  }
}
