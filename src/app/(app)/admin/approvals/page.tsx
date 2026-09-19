import { requireAdminPage } from "@/lib/api";
import { createSupabaseServerClient } from "@/lib/supabase-server";
import { ApprovalsList } from "@/components/admin-approvals";
import { EmptyState } from "@/components/ui";
import { ShieldCheck } from "lucide-react";

export const dynamic = "force-dynamic";
export const metadata = { title: "Approvals" };

export default async function ApprovalsPage() {
  await requireAdminPage();
  const supabase = await createSupabaseServerClient();

  const { data } = await supabase
    .from("profiles")
    .select("id, ign, discord, created_at")
    .eq("status", "pending")
    .order("created_at", { ascending: true });

  const pending = data ?? [];

  return (
    <div className="mx-auto max-w-4xl space-y-5">
      <div>
        <h1 className="font-display text-2xl font-bold tracking-tight">Approvals</h1>
        <p className="mt-1 text-sm text-muted">
          {pending.length} {pending.length === 1 ? "registration" : "registrations"} waiting for review.
        </p>
      </div>

      {pending.length === 0 ? (
        <EmptyState
          icon={<ShieldCheck size={36} />}
          title="No pending members"
          description="New registrations will appear here for review. Approve them to grant access, or reject to decline."
        />
      ) : (
        <ApprovalsList initial={pending} />
      )}
    </div>
  );
}
