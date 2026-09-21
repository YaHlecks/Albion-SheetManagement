import Link from "next/link";
import { CalendarDays, ChevronRight, Swords } from "lucide-react";
import { requirePageSession } from "@/lib/api";
import { createSupabaseServerClient } from "@/lib/supabase-server";
import { Badge, EmptyState, StatCard } from "@/components/ui";

export const dynamic = "force-dynamic";
export const metadata = { title: "Dashboard" };

export default async function DashboardPage() {
  const ctx = await requirePageSession();
  const supabase = await createSupabaseServerClient();

  // Upcoming published/locked events (RLS already scopes visibility; drafts
  // and templates are admin-only by policy).
  const { data: events } = await supabase
    .from("events")
    .select("id, title, event_date, massing_time, timezone, location, set_name, status")
    .in("status", ["published", "locked"])
    .order("event_date", { ascending: true, nullsFirst: false })
    .limit(8);

  // One aggregate query for fill counters (no N+1).
  const eventIds = (events ?? []).map((e) => e.id);
  const fillCounts: Record<string, { filled: number; total: number }> = {};
  if (eventIds.length > 0) {
    const { data: agg } = await supabase
      .from("event_slots")
      .select("id, event_signups(id), event_parties!inner(event_id)")
      .in("event_parties.event_id", eventIds);
    for (const e of events ?? []) fillCounts[e.id] = { filled: 0, total: 0 };
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

  // My signups in those events.
  const { data: mySignups } = eventIds.length > 0
    ? await supabase
        .from("event_signups")
        .select("event_id")
        .eq("user_id", ctx.userId)
        .in("event_id", eventIds)
    : { data: [] as { event_id: string }[] | null };
  const myEventIds = new Set((mySignups ?? []).map((s) => s.event_id));

  const { count: unreadCount } = await supabase
    .from("notifications")
    .select("id", { count: "exact", head: true })
    .eq("user_id", ctx.userId)
    .eq("read", false);

  return (
    <div className="mx-auto max-w-6xl space-y-6">
      <div>
        <h1 className="font-display text-2xl font-bold tracking-tight">Welcome back, {ctx.profile?.ign ?? "player"}</h1>
        <p className="mt-1 text-sm text-muted">Upcoming masses and your signups.</p>
      </div>

      <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
        <StatCard label="Upcoming events" value={events?.length ?? 0} />
        <StatCard
          label="My signups"
          value={[...(events ?? [])].filter((e) => myEventIds.has(e.id)).length}
          tone="success"
        />
        <StatCard label="Unread notifications" value={unreadCount ?? 0} tone={(unreadCount ?? 0) > 0 ? "warn" : "default"} href="/notifications" />
        <StatCard label="Profile" value={ctx.profile?.ign ?? "—"} hint="View or edit your IGN" href="/profile" />
      </div>

      <section className="space-y-3">
        <div className="flex items-center justify-between">
          <h2 className="section-title">Upcoming events</h2>
          <Link href="/events" className="link-brand text-sm">All events <ChevronRight className="inline" size={14} /></Link>
        </div>

        {!events || events.length === 0 ? (
          <EmptyState
            icon={<CalendarDays size={36} />}
            title="No upcoming events"
            description="When an admin publishes a mass, it appears here and you get a notification."
          />
        ) : (
          <div className="grid gap-3 md:grid-cols-2">
            {events.map((event) => {
              const counts = fillCounts[event.id] ?? { filled: 0, total: 0 };
              const mine = myEventIds.has(event.id);
              return (
                <Link key={event.id} href={`/events/${event.id}`} className="panel panel-hover block p-4 transition-colors">
                  <div className="flex items-start justify-between gap-2">
                    <div className="min-w-0">
                      <h3 className="truncate font-display text-base font-semibold">{event.title}</h3>
                      <p className="mt-0.5 text-xs text-faint">
                        {[event.location, event.set_name].filter(Boolean).join(" · ") || "Details inside"}
                      </p>
                    </div>
                    <Badge status={event.status === "locked" ? "locked" : "approved"} />
                  </div>
                  <p className="mt-2 text-sm text-muted">
                    {event.event_date ?? "Date TBA"}
                    {event.massing_time ? ` · ${event.massing_time.slice(0, 5)} ${event.timezone}` : ""}
                  </p>
                  <div className="mt-3 flex items-center justify-between">
                    <span className="text-sm font-semibold">{counts.filled} / {counts.total} slots filled</span>
                    {mine
                      ? <span className="badge badge-approved">You're signed up</span>
                      : <span className="btn btn-primary btn-sm">View & Sign Up</span>}
                  </div>
                </Link>
              );
            })}
          </div>
        )}
      </section>

      <section className="space-y-3">
        <h2 className="section-title">Quick actions</h2>
        <div className="grid gap-3 sm:grid-cols-3">
          <Link href="/events" className="panel panel-hover flex items-center gap-3 p-4 transition-colors">
            <Swords size={20} className="text-brand" />
            <span className="text-sm font-medium">Browse all events</span>
          </Link>
          <Link href="/notifications" className="panel panel-hover flex items-center gap-3 p-4 transition-colors">
            <CalendarDays size={20} className="text-brand" />
            <span className="text-sm font-medium">Notifications</span>
          </Link>
          <Link href="/profile" className="panel panel-hover flex items-center gap-3 p-4 transition-colors">
            <span className="badge badge-role">IGN</span>
            <span className="text-sm font-medium">Profile settings</span>
          </Link>
        </div>
      </section>
    </div>
  );
}
