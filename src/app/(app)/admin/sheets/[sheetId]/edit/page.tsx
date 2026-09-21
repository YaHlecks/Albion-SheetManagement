import Link from "next/link";
import { notFound } from "next/navigation";
import { requireAdminPage } from "@/lib/api";
import { createSupabaseServerClient } from "@/lib/supabase-server";
import { EditMassSheetClient } from "@/components/edit-mass-sheet-client";

export const dynamic = "force-dynamic";
export const metadata = { title: "Edit Mass Sheet" };

export default async function EditMassSheetPage({ params }: { params: Promise<{ sheetId: string }> }) {
  const { sheetId } = await params;
  await requireAdminPage();
  const supabase = await createSupabaseServerClient();

  const [{ data: sheet }, { data: teams }] = await Promise.all([
    supabase
      .from("mass_sheets")
      .select(
        `*, mass_parties ( id, sheet_id, name, fill_note, sort_order,
          mass_slots ( id, party_id, role, build_name, priority, notes, required, sort_order,
            mass_assignments ( id, slot_id, user_id, ign, assigned_at, assigned_by ) ) )`,
      )
      .eq("id", sheetId)
      .maybeSingle(),
    supabase.from("teams").select("id, name").eq("status", "active").order("name"),
  ]);

  if (!sheet) notFound();

  return (
    <div className="mx-auto max-w-5xl space-y-5">
      <div>
        <Link href={`/admin/sheets/${sheetId}`} className="text-sm text-muted hover:text-ink">← Back to sheet</Link>
        <h1 className="mt-1 font-display text-2xl font-bold tracking-tight">Edit Mass Sheet</h1>
        <p className="mt-1 text-sm text-muted">
          Structural changes preserve assignments on untouched slots. Deleting a slot removes its assignment.
        </p>
      </div>
      <EditMassSheetClient
        sheetId={sheetId}
        sheet={sheet}
        teams={(teams ?? []).map((t) => ({ id: t.id, name: t.name }))}
      />
    </div>
  );
}
