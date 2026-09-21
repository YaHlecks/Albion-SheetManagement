import Link from "next/link";
import { CalendarDays } from "lucide-react";
import { requireAdminPage } from "@/lib/api";
import { createSupabaseServerClient } from "@/lib/supabase-server";
import { EmptyState } from "@/components/ui";
import { AdminEvents } from "@/components/admin-events";
import type { EventStatus } from "@/lib/events";

export const dynamic = "force-dynamic";
export const metadata = { title: "Events" };

const TABS: Array<{ key: string; label: string; statuses: EventStatus[] | null; templates?: boolean }> = [
  { key: "active", label: "Active", statuses: ["draft", "published", "locked"] },
  { key: "drafts", label: "Drafts & templates", statuses: null, templates: undefined },
  { key: "past", label: "Completed", statuses: ["completed"] },
  { key: "cancelled", label: "Cancelled", statuses: ["cancelled"] },
  { key: "all", label: "All", statuses: null },
];

export default async function AdminEventsPage({
  searchParams,
}: {
  searchParams: Promise<{ tab?: string }>;
}) {
  await requireAdminPage();
  const { tab } = await searchParams;
  const activeTab = TABS.find((t) => t.key === tab) ?? TABS[0];
  const supabase = await createSupabaseServerClient();

  let query = supabase
    .from("events")
    .select("*")
    .order("event_date", { ascending: true, nullsFirst: false })
    .order("created_at", { ascending: false });

  if (activeTab.statuses) query = query.in("status", activeTab.statuses);
  if (activeTab.key === "drafts") query = query.eq("status", "draft");

  const { data: events } = await query;

  // One aggregate fill-count query (no N+1).
  const eventIds = (events ?? []).map((e) => e.id);
  const fillCounts: Record<string, { filled: number; total: number }> = {};
  for (const e of events ?? []) fillCounts[e.id] = { filled: 0, total: 0 };
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

  return (
    <div className="mx-auto max-w-6xl space-y-5">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <h1 className="font-display text-2xl font-bold tracking-tight">Events</h1>
          <p className="mt-1 text-sm text-muted">Albion masses: parties, builds, and member signups.</p>
        </div>
        <Link href="/admin/events/new" className="btn btn-primary">+ Create Event</Link>
      </div>

      <nav className="flex flex-wrap gap-1" aria-label="Event filters">
        {TABS.map((t) => (
          <Link
            key={t.key}
            href={`/admin/events?tab=${t.key}`}
            className={t.key === activeTab.key ? "badge badge-admin" : "badge badge-neutral"}
            aria-current={t.key === activeTab.key ? "page" : undefined}
          >
            {t.label}
          </Link>
        ))}
      </nav>

      {!events || events.length === 0 ? (
        <EmptyState
          icon={<CalendarDays size={36} />}
          title="No events here"
          description="Create an event, build the parties and slots, then publish it."
          action={<Link href="/admin/events/new" className="btn btn-primary">Create Event</Link>}
        />
      ) : (
        <AdminEvents events={events} fillCounts={fillCounts} />
      )}
    </div>
  );
}
