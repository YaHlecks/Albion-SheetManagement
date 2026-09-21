import Link from "next/link";
import { notFound } from "next/navigation";
import { requirePageSession } from "@/lib/api";
import { createSupabaseServerClient } from "@/lib/supabase-server";
import { MemberSheetView } from "@/components/member-sheet-view";

export const dynamic = "force-dynamic";
export const metadata = { title: "Mass Sheet" };

export default async function MemberSheetPage({ params }: { params: Promise<{ teamId: string; sheetId: string }> }) {
  const { teamId, sheetId } = await params;
  const ctx = await requirePageSession();
  const supabase = await createSupabaseServerClient();

  const { data: sheet } = await supabase
    .from("mass_sheets")
    .select(
      `*, teams ( id, name ),
       mass_parties ( id, sheet_id, name, fill_note, sort_order,
         mass_slots ( id, party_id, role, build_name, priority, notes, required, sort_order,
           mass_assignments ( id, slot_id, user_id, ign, assigned_at, assigned_by ) ) )`,
    )
    .eq("id", sheetId)
    .eq("team_id", teamId)
    .maybeSingle();

  if (!sheet) notFound();

  // Member's profile IGN prefills the claim modal (§14).
  const { data: prof } = await supabase
    .from("profiles")
    .select("ign")
    .eq("id", ctx.userId)
    .maybeSingle();

  return (
    <div className="mx-auto max-w-6xl space-y-5">
      <div>
        <Link href={`/teams/${teamId}/sheets`} className="text-sm text-muted hover:text-ink">← Mass Sheets</Link>
        <MemberSheetView
          teamId={teamId}
          initialSheet={sheet}
          userId={ctx.userId}
          ign={(prof?.ign as string | null) ?? null}
        />
      </div>
    </div>
  );
}
