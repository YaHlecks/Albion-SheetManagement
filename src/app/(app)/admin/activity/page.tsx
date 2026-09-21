import { History } from "lucide-react";
import { requireAdminPage } from "@/lib/api";
import { createSupabaseServerClient } from "@/lib/supabase-server";
import { ActivityViewer } from "@/components/admin-activity";
import { EmptyState } from "@/components/ui";

export const dynamic = "force-dynamic";
export const metadata = { title: "Activity" };

const PAGE_SIZE = 25;

export default async function AdminActivityPage({
  searchParams,
}: {
  searchParams: Promise<{ q?: string; action?: string; page?: string }>;
}) {
  await requireAdminPage();
  const sp = await searchParams;
  const q = (sp.q ?? "").trim();
  const action = sp.action ?? "";
  const page = Math.max(0, parseInt(sp.page ?? "0", 10) || 0);

  const supabase = await createSupabaseServerClient();

  // Resolve a search term to user ids (search by IGN) so "John" finds events
  // where John was the actor or the affected member.
  let userIds: string[] | null = null;
  if (q) {
    const { data: matched } = await supabase
      .from("profiles")
      .select("id")
      .ilike("ign", `%${q}%`)
      .limit(50);
    const ids = (matched ?? []).map((m) => m.id);
    if (ids.length === 0) {
      return <ActivityEmpty />;
    }
    userIds = ids;
  }

  let query = supabase
    .from("audit_logs")
    .select(
      "id, action, meta, created_at, actor_id, target_user_id, event_id, profiles:actor_id(ign), target:target_user_id(ign)",
      { count: "exact" },
    )
    .order("created_at", { ascending: false })
    .range(page * PAGE_SIZE, page * PAGE_SIZE + PAGE_SIZE - 1);

  if (action) query = query.eq("action", action);
  if (userIds) {
    const list = userIds.join(",");
    query = query.or(`actor_id.in.(${list}),target_user_id.in.(${list})`);
  }

  const { data, count } = await query;

  const events = (data ?? []) as unknown as Array<{
    id: string;
    action: string;
    meta: Record<string, unknown>;
    created_at: string;
    actor_id: string | null;
    target_user_id: string | null;
    profiles: { ign: string } | { ign: string }[] | null;
    target: { ign: string } | { ign: string }[] | null;
  }>;

  return (
    <div className="mx-auto max-w-5xl space-y-5">
      <div>
        <h1 className="font-display text-2xl font-bold tracking-tight">Activity</h1>
        <p className="mt-1 text-sm text-muted">Every recorded action with full change details.</p>
      </div>

      {events.length === 0 ? (
        <ActivityEmpty />
      ) : (
        <ActivityViewer events={events} total={count ?? 0} page={page} pageSize={PAGE_SIZE} filters={{ q, action }} />
      )}
    </div>
  );
}

function ActivityEmpty() {
  return (
    <EmptyState
      icon={<History size={36} />}
      title="No activity found"
      description="No entries match the current filters. Try widening your search."
    />
  );
}
