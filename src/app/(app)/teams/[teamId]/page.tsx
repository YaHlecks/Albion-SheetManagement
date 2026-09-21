import Link from "next/link";
import { notFound, redirect } from "next/navigation";
import { ArrowLeft, FolderKanban } from "lucide-react";
import { requirePageSession } from "@/lib/api";
import { createSupabaseServerClient } from "@/lib/supabase-server";
import { SheetTable, type SheetMember } from "@/components/sheet-table";
import { Badge, EmptyState } from "@/components/ui";

export const dynamic = "force-dynamic";

interface TeamRow {
  id: string;
  name: string;
  description: string | null;
  status: string;
  sheet_locked: boolean;
}

export default async function TeamSheetPage({
  params,
}: {
  params: Promise<{ teamId: string }>;
}) {
  const { teamId } = await params;
  const ctx = await requirePageSession();
  const supabase = await createSupabaseServerClient();

  const { data: team } = await supabase
    .from("teams")
    .select("id, name, description, status, sheet_locked")
    .eq("id", teamId)
    .maybeSingle();

  if (!team) {
    notFound();
  }

  const t = team as TeamRow;

  // Membership check — RLS also enforces this, but we render a friendly page.
  const { data: membership } = await supabase
    .from("team_members")
    .select("id")
    .eq("team_id", teamId)
    .eq("user_id", ctx.userId)
    .maybeSingle();

  if (!membership && !ctx.isPlatformAdmin) {
    return (
      <div className="mx-auto max-w-2xl py-10">
        <EmptyState
          icon={<FolderKanban size={36} />}
          title="You do not have access to this team"
          description="You are not a member of this team. If you believe this is a mistake, contact an administrator."
          action={
            <Link href="/teams" className="btn btn-secondary btn-sm">Back to my teams</Link>
          }
        />
      </div>
    );
  }

  const { data: rawMembers } = await supabase
    .from("team_members")
    .select("id, user_id, role, weapon, availability, notes, profiles(ign)")
    .eq("team_id", teamId)
    .order("joined_at", { ascending: true });

  const members: SheetMember[] = (rawMembers ?? [])
    .map((row) => {
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
    })
    .filter((m) => m.ign !== "Unknown" || ctx.isPlatformAdmin);

  return (
    <div className="mx-auto max-w-6xl space-y-5">
      <div>
        <Link href="/teams" className="inline-flex items-center gap-1.5 text-sm text-muted hover:text-ink">
          <ArrowLeft size={15} /> My Teams
        </Link>
      </div>

      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <div className="flex items-center gap-3">
            <h1 className="font-display text-2xl font-bold tracking-tight">{t.name}</h1>
            <Badge status={t.status} />
          </div>
          <p className="mt-1 text-sm text-muted">
            {t.description || "Team sheet"}
            {" · "}
            {members.length} {members.length === 1 ? "member" : "members"}
          </p>
        </div>
        <div className="flex flex-wrap items-center gap-2">
          {t.sheet_locked ? (
            <span className="badge badge-locked text-sm">🔒 Sheet locked</span>
          ) : (
            <span className="badge badge-open text-sm">Sheet open</span>
          )}
          <Link href={`/teams/${teamId}/sheets`} className="btn btn-secondary btn-sm">Mass Sheets</Link>
        </div>
      </div>

      <SheetTable
        members={members}
        canEdit={true}
        isAdmin={ctx.isPlatformAdmin}
        locked={t.sheet_locked}
        teamStatus={t.status}
        currentUserId={ctx.userId}
      />
    </div>
  );
}
