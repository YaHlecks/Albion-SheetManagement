import Link from "next/link";
import { notFound } from "next/navigation";
import { ArrowLeft } from "lucide-react";
import { requireAdminPage } from "@/lib/api";
import { createSupabaseServerClient } from "@/lib/supabase-server";
import { createAdminClient, hasServiceRole } from "@/lib/supabase-admin";
import { SheetTable } from "@/components/sheet-table";
import { TeamAdminControls } from "@/components/admin-team-detail";
import { AdminMemberTable } from "@/components/admin-member-table";
import { Badge } from "@/components/ui";

export const dynamic = "force-dynamic";

export default async function AdminTeamDetailPage({
  params,
}: {
  params: Promise<{ teamId: string }>;
}) {
  const { teamId } = await params;
  await requireAdminPage();

  const supabase = hasServiceRole() ? createAdminClient() : await createSupabaseServerClient();

  const { data: team } = await supabase
    .from("teams")
    .select("id, name, description, status, sheet_locked")
    .eq("id", teamId)
    .maybeSingle();

  if (!team) notFound();

  const { data: rawMembers } = await supabase
    .from("team_members")
    .select("id, user_id, role, weapon, availability, notes, profiles(ign)")
    .eq("team_id", teamId)
    .order("joined_at", { ascending: true });

  const members = (rawMembers ?? []).map((row) => {
    const p = Array.isArray(row.profiles) ? row.profiles[0] : row.profiles;
    return {
      id: row.id,
      user_id: row.user_id,
      ign: typeof p === "object" && p !== null ? (p as { ign: string }).ign : "Unknown",
      role: row.role,
      weapon: row.weapon,
      availability: row.availability,
      notes: row.notes,
    };
  });

  // Assigned mass sheets (Phase 18) — counts shown on the team header.
  const { data: massSheets } = await supabase
    .from("mass_sheets")
    .select("id, title, status, mass_at, timezone")
    .eq("team_id", teamId)
    .order("mass_at", { ascending: false, nullsFirst: false });

  return (
    <div className="mx-auto max-w-6xl space-y-5">
      <div>
        <Link href="/admin/teams" className="inline-flex items-center gap-1.5 text-sm text-muted hover:text-ink">
          <ArrowLeft size={15} /> Teams
        </Link>
      </div>

      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <div className="flex items-center gap-3">
            <h1 className="font-display text-2xl font-bold tracking-tight">{team.name}</h1>
            <Badge status={team.status} />
          </div>
          <p className="mt-1 text-sm text-muted">
            {team.description || "Team sheet"} · {members.length} members
          </p>
        </div>
        <TeamAdminControls
          team={{ id: team.id, name: team.name, status: team.status, sheet_locked: team.sheet_locked }}
        />
      </div>

      <SheetTable
        members={members}
        canEdit={true}
        isAdmin={true}
        locked={team.sheet_locked}
        teamStatus={team.status}
        currentUserId=""
      />

      <section className="space-y-3">
        <div className="flex items-center justify-between">
          <h2 className="section-title">Assigned Mass Sheets ({massSheets?.length ?? 0})</h2>
          <Link href="/admin/sheets/new" className="btn btn-secondary btn-sm">+ Create Mass</Link>
        </div>
        {(massSheets ?? []).length === 0 ? (
          <p className="panel p-4 text-sm text-muted">No mass sheets assigned to this team yet.</p>
        ) : (
          <div className="grid gap-2 md:grid-cols-2">
            {(massSheets ?? []).map((s) => (
              <Link key={s.id} href={`/admin/sheets/${s.id}`} className="panel panel-hover flex items-center justify-between p-3 transition-colors">
                <div>
                  <p className="text-sm font-medium">{s.title}</p>
                  <p className="text-xs text-faint">{s.mass_at ? new Date(s.mass_at).toLocaleString() : "No time set"}</p>
                </div>
                <Badge status={s.status === "published" ? "approved" : s.status === "locked" ? "locked" : s.status === "archived" ? "archived" : "draft"} />
              </Link>
            ))}
          </div>
        )}
      </section>

      <section className="space-y-3">
        <h2 className="section-title">Membership</h2>
        <AdminMemberTable
          teamId={team.id}
          members={members.map((m) => ({
            id: m.id,
            user_id: m.user_id,
            ign: m.ign,
            role: m.role,
            joined_at: "",
          }))}
        />
      </section>
    </div>
  );
}
