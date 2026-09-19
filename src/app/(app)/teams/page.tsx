import Link from "next/link";
import { ClipboardList, ChevronRight } from "lucide-react";
import { requirePageSession } from "@/lib/api";
import { createSupabaseServerClient } from "@/lib/supabase-server";
import { Badge, EmptyState } from "@/components/ui";

export const dynamic = "force-dynamic";
export const metadata = { title: "My Teams" };

export default async function TeamsPage() {
  const ctx = await requirePageSession();
  const supabase = await createSupabaseServerClient();

  const { data: memberships } = await supabase
    .from("team_members")
    .select("id, team_id, role, teams(id, name, status, sheet_locked, description)")
    .eq("user_id", ctx.userId);

  const rows = (memberships ?? [])
    .map((m) => {
      const t = Array.isArray(m.teams) ? m.teams[0] : m.teams;
      if (!t || typeof t === "string") return null;
      const team = t as { id: string; name: string; status: string; sheet_locked: boolean; description: string | null };
      return { membershipId: m.id, myRole: m.role, team };
    })
    .filter((r): r is NonNullable<typeof r> => r !== null);

  return (
    <div className="mx-auto max-w-6xl space-y-6">
      <div>
        <h1 className="font-display text-2xl font-bold tracking-tight">My Teams</h1>
        <p className="mt-1 text-sm text-muted">Teams you have been assigned to.</p>
      </div>

      {rows.length === 0 ? (
        <EmptyState
          icon={<ClipboardList size={36} />}
          title="No teams yet"
          description="You haven't been assigned to any team. When an administrator adds you, it will appear here with a notification."
        />
      ) : (
        <div className="grid gap-3 md:grid-cols-2 lg:grid-cols-3">
          {rows.map(({ team, myRole }) => (
            <Link key={team.id} href={`/teams/${team.id}`} className="panel panel-hover block p-5 transition-colors">
              <div className="flex items-center justify-between gap-2">
                <h2 className="font-display text-base font-semibold">{team.name}</h2>
                <Badge status={team.status} />
              </div>
              <p className="mt-1 line-clamp-2 min-h-8 text-xs text-faint">{team.description || "No description"}</p>
              <div className="mt-4 flex items-center justify-between">
                <span className="badge badge-role">{myRole}</span>
                <span className="inline-flex items-center gap-1 text-sm font-semibold text-brand">
                  {team.sheet_locked ? "View sheet" : "Open sheet"} <ChevronRight size={15} />
                </span>
              </div>
            </Link>
          ))}
        </div>
      )}
    </div>
  );
}
