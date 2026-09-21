import Link from "next/link";
import { ScrollText } from "lucide-react";
import { requireAdminPage } from "@/lib/api";
import { createSupabaseServerClient } from "@/lib/supabase-server";
import { EmptyState } from "@/components/ui";
import { AdminMassSheets } from "@/components/admin-mass-sheets";

export const dynamic = "force-dynamic";
export const metadata = { title: "Mass Sheets" };

export default async function AdminSheetsPage() {
  await requireAdminPage();
  const supabase = await createSupabaseServerClient();

  const { data: sheets } = await supabase
    .from("mass_sheets")
    .select("*, teams ( id, name )")
    .neq("status", "archived")
    .order("mass_at", { ascending: false, nullsFirst: false });

  // ONE aggregate query for fill counters across all visible sheets (§34 — no N+1).
  const sheetIds = (sheets ?? []).map((s) => s.id);
  const fillCounts: Record<string, { filled: number; total: number }> = {};
  for (const s of sheets ?? []) fillCounts[s.id] = { filled: 0, total: 0 };

  if (sheetIds.length > 0) {
    const { data: agg } = await supabase
      .from("mass_slots")
      .select("id, party_id, mass_assignments(id), mass_parties!inner(sheet_id)")
      .in("mass_parties.sheet_id", sheetIds);

    for (const row of (agg ?? []) as unknown as Array<{
      mass_parties: { sheet_id: string } | { sheet_id: string }[];
      mass_assignments: unknown[];
    }>) {
      const mp = Array.isArray(row.mass_parties) ? row.mass_parties[0] : row.mass_parties;
      const bucket = mp ? fillCounts[mp.sheet_id] : undefined;
      if (!bucket) continue;
      bucket.total += 1;
      if (Array.isArray(row.mass_assignments) && row.mass_assignments.length > 0) bucket.filled += 1;
    }
  }

  return (
    <div className="mx-auto max-w-6xl space-y-5">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <h1 className="font-display text-2xl font-bold tracking-tight">Mass Sheets</h1>
          <p className="mt-1 text-sm text-muted">Albion mass sheets: parties, builds, and live slot filling.</p>
        </div>
        <Link href="/admin/sheets/new" className="btn btn-primary">+ Create Mass Sheet</Link>
        <Link href="/admin/sheets/archive" className="btn btn-secondary">Archive</Link>
      </div>

      {!sheets || sheets.length === 0 ? (
        <EmptyState
          icon={<ScrollText size={36} />}
          title="No mass sheets yet"
          description="Create your first mass sheet to start organizing masses."
          action={<Link href="/admin/sheets/new" className="btn btn-primary">Create Mass Sheet</Link>}
        />
      ) : (
        <AdminMassSheets sheets={sheets} fillCounts={fillCounts} />
      )}
    </div>
  );
}
