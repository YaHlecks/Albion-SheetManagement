import Link from "next/link";
import { ChevronRight, Users } from "lucide-react";
import { requireAdminPage } from "@/lib/api";
import { createSupabaseServerClient } from "@/lib/supabase-server";
import { Badge, EmptyState, StatCard } from "@/components/ui";

export const dynamic = "force-dynamic";
export const metadata = { title: "Admin" };

export default async function AdminDashboardPage() {
  await requireAdminPage();
  const supabase = await createSupabaseServerClient();

  const [{ count: publishedCount }, { count: draftCount }, { count: pendingCount }, { data: upcoming }] =
    await Promise.all([
      supabase.from("events").select("id", { count: "exact", head: true }).eq("status", "published"),
      supabase.from("events").select("id", { count: "exact", head: true }).eq("status", "draft"),
      supabase.from("profiles").select("id", { count: "exact", head: true }).eq("status", "pending"),
      supabase
        .from("events")
        .select("id, title, event_date, massing_time, timezone, location, status")
        .in("status", ["draft", "published", "locked"])
        .order("event_date", { ascending: true, nullsFirst: false })
        .limit(5),
    ]);

  // One aggregate fill-count query for the upcoming list.
  const eventIds = (upcoming ?? []).map((e) => e.id);
  const fillCounts: Record<string, { filled: number; total: number }> = {};
  for (const e of upcoming ?? []) fillCounts[e.id] = { filled: 0, total: 0 };
  if (eventIds.length > 0) {
    const { data: agg } = await supabase
      .from("event_slots")
      .select("id, event_signups(id), event_parties!inner(event_id)")
      .in("event_parties.event_id", eventIds);
    for (const row of (agg ?? []) as unknown as Array<{
      event_parties: { event_id: string } | { event_id: string }[];
      event_signups: unknown[];
    }>) {
      const ep = Array.isArray(row.event_parties) ? row.event_parties[0] : row.event_parties;
      const bucket = ep ? fillCounts[ep.event_id] : undefined;
      if (!bucket) continue;
      bucket.total += 1;
      if (Array.isArray(row.event_signups) && row.event_signups.length > 0) bucket.filled += 1;
    }
  }

  const { data: recent } = await supabase
    .from("audit_logs")
    .select("id, action, created_at, actor_id, profiles:actor_id(ign)")
    .order("created_at", { ascending: false })
    .limit(8);

  return (
    <div className="mx-auto max-w-6xl space-y-6">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <h1 className="font-display text-2xl font-bold tracking-tight">Admin</h1>
          <p className="mt-1 text-sm text-muted">Events, members, and oversight.</p>
        </div>
        <Link href="/admin/events/new" className="btn btn-primary">+ Create Event</Link>
      </div>

      <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
        <StatCard label="Published events" value={publishedCount ?? 0} tone="success" href="/admin/events?tab=active" />
        <StatCard label="Drafts" value={draftCount ?? 0} href="/admin/events?tab=drafts" />
        <StatCard label="Pending members" value={pendingCount ?? 0} tone={(pendingCount ?? 0) > 0 ? "warn" : "default"} href="/admin/approvals" />
        <StatCard label="Members" value="…" href="/admin/accounts" hint="All accounts" />
      </div>

      <section className="space-y-3">
        <div className="flex items-center justify-between">
          <h2 className="section-title">Next events</h2>
          <Link href="/admin/events" className="link-brand text-sm">All events <ChevronRight className="inline" size={14} /></Link>
        </div>
        {!upcoming || upcoming.length === 0 ? (
          <EmptyState
            title="No events yet"
            description="Create your first mass — parties, builds, publish, and members sign up."
            action={<Link href="/admin/events/new" className="btn btn-primary">Create Event</Link>}
          />
        ) : (
          <div className="space-y-2">
            {upcoming.map((event) => {
              const counts = fillCounts[event.id] ?? { filled: 0, total: 0 };
              return (
                <Link key={event.id} href={`/admin/events/${event.id}`} className="panel panel-hover flex flex-wrap items-center justify-between gap-3 p-4 transition-colors">
                  <div className="min-w-0">
                    <div className="flex items-center gap-2">
                      <h3 className="truncate font-medium">{event.title}</h3>
                      <Badge status={event.status === "published" ? "approved" : event.status === "locked" ? "locked" : "draft"} />
                    </div>
                    <p className="mt-0.5 text-xs text-faint">
                      {[event.location, event.event_date, event.massing_time ? `${event.massing_time.slice(0, 5)} ${event.timezone}` : null].filter(Boolean).join(" · ") || "Details inside"}
                    </p>
                  </div>
                  <span className="text-sm font-semibold">{counts.filled} / {counts.total} filled</span>
                </Link>
              );
            })}
          </div>
        )}
      </section>

      <div className="grid gap-6 lg:grid-cols-2">
        <section className="space-y-3">
          <div className="flex items-center justify-between">
            <h2 className="section-title">Members</h2>
            <Link href="/admin/approvals" className="link-brand text-sm">Approvals <ChevronRight className="inline" size={14} /></Link>
          </div>
          <div className="panel flex items-center gap-4 p-4">
            <Users className="text-brand" size={22} />
            <div>
              <p className="text-sm font-medium">{pendingCount ?? 0} pending approval</p>
              <p className="text-xs text-faint">Approve, suspend or review accounts in Members.</p>
            </div>
            <Link href="/admin/accounts" className="btn btn-secondary btn-sm ml-auto">Manage</Link>
          </div>
        </section>

        <section className="space-y-3">
          <div className="flex items-center justify-between">
            <h2 className="section-title">Recent activity</h2>
            <Link href="/admin/activity" className="link-brand text-sm">Audit log <ChevronRight className="inline" size={14} /></Link>
          </div>
          <div className="panel divide-y divide-line p-0">
            {(recent ?? []).length === 0 ? (
              <p className="p-4 text-sm text-muted">No activity recorded yet.</p>
            ) : (
              (recent ?? []).map((row) => {
                const actor = Array.isArray(row.profiles) ? row.profiles[0] : row.profiles;
                return (
                  <div key={row.id} className="flex items-center justify-between gap-3 px-4 py-2.5 text-sm">
                    <span className="truncate">
                      <span className="font-medium">{(actor as { ign?: string } | null)?.ign ?? "System"}</span>
                      <span className="text-muted"> · {row.action.replaceAll("_", " ").toLowerCase()}</span>
                    </span>
                    <span className="shrink-0 text-xs text-faint">{new Date(row.created_at).toLocaleString()}</span>
                  </div>
                );
              })
            )}
          </div>
        </section>
      </div>
    </div>
  );
}
