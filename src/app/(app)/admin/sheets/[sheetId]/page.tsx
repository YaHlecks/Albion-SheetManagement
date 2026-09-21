import Link from "next/link";
import { requireAdminPage } from "@/lib/api";
import { createSupabaseServerClient } from "@/lib/supabase-server";
import { AdminSheetDetail } from "@/components/admin-sheet-detail";

export const dynamic = "force-dynamic";
export const metadata = { title: "Mass Sheet" };

export default async function AdminSheetDetailPage({ params }: { params: Promise<{ sheetId: string }> }) {
  const { sheetId } = await params;
  await requireAdminPage();
  const supabase = await createSupabaseServerClient();

  const { data } = await supabase
    .from("mass_sheets")
    .select(
      `*, teams ( id, name ),
       mass_parties ( id, sheet_id, name, fill_note, sort_order,
         mass_slots ( id, party_id, role, build_name, priority, notes, required, sort_order,
           mass_assignments ( id, slot_id, user_id, ign, assigned_at, assigned_by ) ) )`,
    )
    .eq("id", sheetId)
    .maybeSingle();

  return (
    <div className="mx-auto max-w-6xl space-y-5">
      <div>
        <Link href="/admin/sheets" className="text-sm text-muted hover:text-ink">← Mass Sheets</Link>
        <AdminSheetDetail
          sheetId={sheetId}
          initialSheet={data ?? null}
        />
      </div>
    </div>
  );
}
