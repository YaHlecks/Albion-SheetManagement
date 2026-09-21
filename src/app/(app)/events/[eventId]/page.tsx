import Link from "next/link";
import { notFound } from "next/navigation";
import { requirePageSession } from "@/lib/api";
import { createSupabaseServerClient } from "@/lib/supabase-server";
import { MemberEventView } from "@/components/member-event-view";

export const dynamic = "force-dynamic";
export const metadata = { title: "Event" };

export default async function EventPage({ params }: { params: Promise<{ eventId: string }> }) {
  const { eventId } = await params;
  const ctx = await requirePageSession();
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
        <Link href="/events" className="text-sm text-muted hover:text-ink">← Events</Link>
        <MemberEventView eventId={eventId} initialEvent={event} userId={ctx.userId} />
      </div>
    </div>
  );
}
