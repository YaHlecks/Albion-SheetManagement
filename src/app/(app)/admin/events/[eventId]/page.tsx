import Link from "next/link";
import { notFound } from "next/navigation";
import { requireAdminPage } from "@/lib/api";
import { createSupabaseServerClient } from "@/lib/supabase-server";
import { EVENT_SELECT, type EventFull } from "@/lib/events";
import { AdminEventDetail } from "@/components/admin-event-detail";

export const dynamic = "force-dynamic";
export const metadata = { title: "Event" };

export default async function AdminEventPage({ params }: { params: Promise<{ eventId: string }> }) {
  const { eventId } = await params;
  await requireAdminPage();
  const supabase = await createSupabaseServerClient();

  const { data: event } = await supabase
    .from("events")
    .select(EVENT_SELECT)
    .eq("id", eventId)
    .maybeSingle();

  if (!event) notFound();

  return (
    <div className="mx-auto max-w-6xl space-y-5">
      <div>
        <Link href="/admin/events" className="text-sm text-muted hover:text-ink">← Events</Link>
        <AdminEventDetail eventId={eventId} initialEvent={event as unknown as EventFull} />
      </div>
    </div>
  );
}
