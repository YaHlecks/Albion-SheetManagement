import Link from "next/link";
import { notFound } from "next/navigation";
import { requireAdminPage } from "@/lib/api";
import { createSupabaseServerClient } from "@/lib/supabase-server";
import { AdminEventDetail } from "@/components/admin-event-detail";

export const dynamic = "force-dynamic";
export const metadata = { title: "Event" };

export default async function AdminEventPage({ params }: { params: Promise<{ eventId: string }> }) {
  const { eventId } = await params;
  await requireAdminPage();
  const supabase = await createSupabaseServerClient();

  const { data: event } = await supabase
    .from("events")
    .select(
      `*, event_parties ( id, event_id, name, fill_note, sort_order,
        event_slots ( id, party_id, role, equipment, tier_requirement, notes, priority, required, sort_order,
          event_signups ( id, slot_id, event_id, user_id, ign, note, signed_up_at ) ) )`,
    )
    .eq("id", eventId)
    .maybeSingle();

  if (!event) notFound();

  return (
    <div className="mx-auto max-w-6xl space-y-5">
      <div>
        <Link href="/admin/events" className="text-sm text-muted hover:text-ink">← Events</Link>
        <AdminEventDetail eventId={eventId} initialEvent={event} />
      </div>
    </div>
  );
}
