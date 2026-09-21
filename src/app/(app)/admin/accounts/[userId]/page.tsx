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

  // This member's event signups + their recent audit trail.
  const { data: signups } = await supabase
    .from("event_signups")
    .select("id, signed_up_at, ign, events ( id, title, status, event_date )")
    .eq("user_id", userId)
    .order("signed_up_at", { ascending: false })
    .limit(10);

  const { data: activity } = await supabase
    .from("audit_logs")
    .select("id, action, meta, created_at")
    .eq("actor_id", userId)
    .order("created_at", { ascending: false })
    .limit(10);

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
        <h2 className="section-title mb-4">Event signups</h2>
        {(signups ?? []).length === 0 ? (
          <p className="py-4 text-center text-sm text-muted">No event signups.</p>
        ) : (
          <ul className="divide-y divide-line">
            {(signups ?? []).map((s) => {
              const e = Array.isArray(s.events) ? s.events[0] : s.events;
              const ev = e && typeof e === "object" ? (e as { id: string; title: string; status: string; event_date: string | null }) : null;
              return (
                <li key={s.id} className="flex items-center justify-between py-2.5 text-sm">
                  {ev ? (
                    <Link href={`/admin/events/${ev.id}`} className="font-semibold text-brand hover:underline">{ev.title}</Link>
                  ) : (
                    <span className="text-muted">(deleted event)</span>
                  )}
                  <span className="flex items-center gap-2">
                    <span className="text-xs text-faint">{s.signed_up_at ? timeAgo(s.signed_up_at) : ""}</span>
                    {ev ? <Badge status={ev.status === "published" ? "approved" : ev.status === "locked" ? "locked" : "archived"} /> : null}
                  </span>
                </li>
              );
            })}
          </ul>
        )}
      </section>

      <section className="panel p-5">
        <h2 className="section-title mb-4">Recent activity</h2>
        {!activity || activity.length === 0 ? (
          <p className="py-4 text-center text-sm text-muted">No recorded activity.</p>
        ) : (
          <ul className="divide-y divide-line">
            {activity.map((a) => (
              <li key={a.id} className="flex items-center justify-between gap-3 py-2.5 text-sm">
                <span className="min-w-0 truncate">{describeUserAction(a.action, a.meta)}</span>
                <span className="shrink-0 text-xs text-faint">{timeAgo(a.created_at)}</span>
              </li>
            ))}
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
    case "EVENT_CREATED": return "Created an event";
    case "EVENT_UPDATED": return "Updated an event";
    case "EVENT_PUBLISHED": return "Published an event";
    case "EVENT_LOCKED": return "Locked an event";
    case "EVENT_CANCELLED": return "Cancelled an event";
    case "SIGNUP_CREATED": return "Signed up to an event";
    case "SIGNUP_REMOVED": return "Removed a signup";
    case "SIGNUP_MOVED": return "Moved a signup";
    case "PERMISSION_CHANGED": return "Changed permissions";
    default: return action.toLowerCase().replaceAll("_", " ");
  }
}
