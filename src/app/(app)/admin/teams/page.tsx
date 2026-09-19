import { FolderKanban } from "lucide-react";
import Link from "next/link";
import { requireAdminPage } from "@/lib/api";
import { createSupabaseServerClient } from "@/lib/supabase-server";
import { AdminTeamsClient } from "@/components/admin-teams";
import { EmptyState } from "@/components/ui";

export const dynamic = "force-dynamic";
export const metadata = { title: "Teams" };

export default async function AdminTeamsPage() {
  await requireAdminPage();
  const supabase = await createSupabaseServerClient();

  const { data: teams } = await supabase
    .from("teams")
    .select("id, name, description, status, sheet_locked, created_at")
    .order("created_at", { ascending: false });

  const { data: counts } = await supabase.from("team_members").select("team_id");
  const memberCounts: Record<string, number> = {};
  for (const c of counts ?? []) {
    memberCounts[c.team_id] = (memberCounts[c.team_id] ?? 0) + 1;
  }

  return (
    <div className="mx-auto max-w-6xl space-y-5">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <h1 className="font-display text-2xl font-bold tracking-tight">Teams</h1>
          <p className="mt-1 text-sm text-muted">Create teams, manage membership, lock sheets.</p>
        </div>
      </div>

      {!teams || teams.length === 0 ? (
        <EmptyState
          icon={<FolderKanban size={36} />}
          title="No teams yet"
          description="Create your first team to start building rosters."
        />
      ) : (
        <AdminTeamsClient
          teams={teams.map((t) => ({ ...t, memberCount: memberCounts[t.id] ?? 0 }))}
        />
      )}
    </div>
  );
}
