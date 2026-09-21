import Link from "next/link";
import { requireAdminPage } from "@/lib/api";
import { createSupabaseServerClient } from "@/lib/supabase-server";
import { NewMassSheetClient } from "@/components/new-mass-sheet-client";

export const dynamic = "force-dynamic";
export const metadata = { title: "Create Mass Sheet" };

export default async function NewMassSheetPage() {
  await requireAdminPage();
  const supabase = await createSupabaseServerClient();
  const { data: teams } = await supabase
    .from("teams")
    .select("id, name")
    .eq("status", "active")
    .order("name");

  return (
    <div className="mx-auto max-w-5xl space-y-5">
      <div>
        <Link href="/admin/sheets" className="text-sm text-muted hover:text-ink">← Mass Sheets</Link>
        <h1 className="mt-1 font-display text-2xl font-bold tracking-tight">Create Mass Sheet</h1>
        <p className="mt-1 text-sm text-muted">
          Configure the mass information, build parties and required builds, then publish to the team.
        </p>
      </div>
      <NewMassSheetClient
        teams={(teams ?? []).map((t) => ({ id: t.id, name: t.name }))}
      />
    </div>
  );
}
