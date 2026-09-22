import Link from "next/link";
import { notFound } from "next/navigation";
import { requireAdminPage } from "@/lib/api";
import { createSupabaseServerClient } from "@/lib/supabase-server";
import { EVENT_SELECT } from "@/lib/events";
import { EditEventClient } from "@/components/edit-event-client";

export const dynamic = "force-dynamic";
export const metadata = { title: "Edit Event" };

export default async function EditEventPage({ params }: { params: Promise<{ eventId: string }> }) {
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
    <div className="mx-auto max-w-5xl space-y-5">
      <div>
        <Link href={`/admin/events/${eventId}`} className="text-sm text-muted hover:text-ink">← Back to event</Link>
        <h1 className="mt-1 font-display text-2xl font-bold tracking-tight">Edit Event</h1>
        <p className="mt-1 text-sm text-muted">
          Structural changes keep signups on untouched slots; deleting a slot removes its signup.
        </p>
      </div>
      <EditEventClient eventId={eventId} event={event} />
    </div>
  );
}
