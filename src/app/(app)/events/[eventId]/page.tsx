import Link from "next/link";
import { notFound } from "next/navigation";
import { requirePageSession } from "@/lib/api";
import { createSupabaseServerClient } from "@/lib/supabase-server";
import { EVENT_SELECT, type EventFull } from "@/lib/events";
import { MemberEventView } from "@/components/member-event-view";

export const dynamic = "force-dynamic";
export const metadata = { title: "Event" };

export default async function EventPage({ params }: { params: Promise<{ eventId: string }> }) {
  const { eventId } = await params;
  const ctx = await requirePageSession();
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
        <Link href="/events" className="text-sm text-muted hover:text-ink">← Events</Link>
        <MemberEventView eventId={eventId} initialEvent={event as unknown as EventFull} userId={ctx.userId} />
      </div>
    </div>
  );
}
