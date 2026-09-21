import Link from "next/link";
import { CalendarDays } from "lucide-react";
import { requirePageSession } from "@/lib/api";
import { createSupabaseServerClient } from "@/lib/supabase-server";
import { Badge, EmptyState } from "@/components/ui";

export const dynamic = "force-dynamic";
export const metadata = { title: "Events" };

export default async function EventsPage() {
  const ctx = await requirePageSession();
  const supabase = await createSupabaseServerClient();

  const { data: events } = await supabase
    .from("events")
    .select("id, title, event_date, massing_time, timezone, location, set_name, status")
    .in("status", ["published", "locked", "completed"])
    .order("event_date", { ascending: true, nullsFirst: false });

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

  const { data: mySignups } = eventIds.length > 0
    ? await supabase.from("event_signups").select("event_id").eq("user_id", ctx.userId).in("event_id", eventIds)
    : { data: [] as { event_id: string }[] | null };
  const mine = new Set((mySignups ?? []).map((s) => s.event_id));

  return (
    <div className="mx-auto max-w-6xl space-y-5">
      <div>
        <h1 className="font-display text-2xl font-bold tracking-tight">Events</h1>
        <p className="mt-1 text-sm text-muted">Published masses — pick a slot and get your IGN on the sheet.</p>
      </div>

      {!events || events.length === 0 ? (
        <EmptyState
          icon={<CalendarDays size={36} />}
          title="No events yet"
          description="When an admin publishes a mass, it appears here and you receive a notification."
        />
      ) : (
        <div className="grid gap-3 md:grid-cols-2 xl:grid-cols-3">
          {events.map((event) => {
            const counts = fillCounts[event.id] ?? { filled: 0, total: 0 };
            return (
              <Link key={event.id} href={`/events/${event.id}`} className="panel panel-hover block p-4 transition-colors">
                <div className="flex items-start justify-between gap-2">
                  <h2 className="truncate font-display text-base font-semibold">{event.title}</h2>
                  <Badge status={event.status === "published" ? "approved" : event.status === "locked" ? "locked" : "archived"} />
                </div>
                <p className="mt-1 text-xs text-faint">{[event.location, event.set_name].filter(Boolean).join(" · ") || "—"}</p>
                <p className="mt-2 text-sm text-muted">
                  {event.event_date ?? "Date TBA"}{event.massing_time ? ` · ${event.massing_time.slice(0, 5)} ${event.timezone}` : ""}
                </p>
                <div className="mt-3 flex items-center justify-between">
                  <span className="text-sm font-semibold">{counts.filled} / {counts.total} filled</span>
                  {mine.has(event.id) && <span className="badge badge-approved">Signed up</span>}
                </div>
              </Link>
            );
          })}
        </div>
      )}
    </div>
  );
}
