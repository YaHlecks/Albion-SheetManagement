import Link from "next/link";
import { requireAdminPage } from "@/lib/api";
import { NewEventClient } from "@/components/new-event-client";

export const dynamic = "force-dynamic";
export const metadata = { title: "Create Event" };

export default async function NewEventPage({
  searchParams,
}: {
  searchParams: Promise<{ template?: string }>;
}) {
  await requireAdminPage();
  const { template } = await searchParams;

  return (
    <div className="mx-auto max-w-5xl space-y-5">
      <div>
        <Link href="/admin/events" className="text-sm text-muted hover:text-ink">← Events</Link>
        <h1 className="mt-1 font-display text-2xl font-bold tracking-tight">Create Event</h1>
        <p className="mt-1 text-sm text-muted">
          Define the mass information, build parties and required equipment, then publish to members.
        </p>
      </div>
      <NewEventClient startAsTemplate={template === "1"} />
    </div>
  );
}
