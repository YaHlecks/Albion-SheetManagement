import Link from "next/link";
import { ScrollText } from "lucide-react";
import { requirePageSession } from "@/lib/api";
import { createSupabaseServerClient } from "@/lib/supabase-server";
import { Badge, EmptyState } from "@/components/ui";

export const dynamic = "force-dynamic";
export const metadata = { title: "Mass Sheets" };

export default async function TeamSheetsPage({ params }: { params: Promise<{ teamId: string }> }) {
  const { teamId } = await params;
  const ctx = await requirePageSession();
  const supabase = await createSupabaseServerClient();

  // RLS guarantees team isolation; drafts are excluded in the query for clarity.
  const { data: sheets } = await supabase
    .from("mass_sheets")
    .select("id, title, location, set_name, mass_at, timezone, status")
    .eq("team_id", teamId)
    .in("status", ["published", "locked"])
    .order("mass_at", { ascending: false, nullsFirst: false });

  const { data: team } = await supabase
    .from("teams")
    .select("id, name")
    .eq("id", teamId)
    .maybeSingle();

  return (
    <div className="mx-auto max-w-5xl space-y-5">
      <div>
        <Link href={`/teams/${teamId}`} className="text-sm text-muted hover:text-ink">← Back to team</Link>
        <h1 className="mt-1 font-display text-2xl font-bold tracking-tight">Mass Sheets</h1>
        <p className="mt-1 text-sm text-muted">{team?.name ?? "Team"}</p>
      </div>

      {!sheets || sheets.length === 0 ? (
        <EmptyState
          icon={<ScrollText size={36} />}
          title="No active mass sheets"
          description="Your team has no published masses right now. When an admin publishes one, it appears here."
        />
      ) : (
        <div className="grid gap-3 md:grid-cols-2">
          {sheets.map((sheet) => (
            <Link
              key={sheet.id}
              href={`/teams/${teamId}/sheets/${sheet.id}`}
              className="panel panel-hover block p-4 transition-colors"
            >
              <div className="flex items-start justify-between gap-2">
                <h2 className="font-display text-base font-semibold">{sheet.title}</h2>
                <Badge status={sheet.status === "locked" ? "locked" : "approved"} />
              </div>
              <p className="mt-1 text-xs text-faint">
                {[sheet.location, sheet.set_name].filter(Boolean).join(" · ") || "No location"}
              </p>
              {sheet.mass_at && (
                <p className="mt-2 text-sm">
                  Massing: {safeFmt(sheet.mass_at, sheet.timezone)}
                </p>
              )}
            </Link>
          ))}
        </div>
      )}
    </div>
  );
}

function safeFmt(at: string, tz: string | null): string {
  try {
    return `${new Intl.DateTimeFormat("en-GB", { timeZone: tz || "UTC", dateStyle: "medium", timeStyle: "short" }).format(new Date(at))} (${tz || "UTC"})`;
  } catch {
    return new Date(at).toLocaleString();
  }
}
