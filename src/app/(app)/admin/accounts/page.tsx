import { Users } from "lucide-react";
import Link from "next/link";
import { requireAdminPage } from "@/lib/api";
import { createSupabaseServerClient } from "@/lib/supabase-server";
import { createAdminClient, hasServiceRole } from "@/lib/supabase-admin";
import { AccountsTable } from "@/components/admin-accounts";
import { EmptyState } from "@/components/ui";

export const dynamic = "force-dynamic";
export const metadata = { title: "Members" };

const PAGE_SIZE = 20;

export default async function AdminAccountsPage({
  searchParams,
}: {
  searchParams: Promise<{ q?: string; status?: string; page?: string }>;
}) {
  await requireAdminPage();
  const sp = await searchParams;
  const q = (sp.q ?? "").trim();
  const status = sp.status ?? "";
  const page = Math.max(0, parseInt(sp.page ?? "0", 10) || 0);

  const supabase = hasServiceRole() ? createAdminClient() : await createSupabaseServerClient();
  let query = supabase
    .from("profiles")
    .select("id, ign, discord, status, is_platform_admin, created_at, last_login_at", { count: "exact" })
    .order("created_at", { ascending: false })
    .range(page * PAGE_SIZE, page * PAGE_SIZE + PAGE_SIZE - 1);

  if (status) query = query.eq("status", status);
  if (q) query = query.ilike("ign", `%${q}%`);

  const { data, count } = await query;

  const accounts = data ?? [];
  const total = count ?? 0;

  return (
    <div className="mx-auto max-w-6xl space-y-5">
      <div>
        <h1 className="font-display text-2xl font-bold tracking-tight">Members</h1>
        <p className="mt-1 text-sm text-muted">All registered accounts, their status and memberships.</p>
      </div>

      {accounts.length === 0 ? (
        <EmptyState
          icon={<Users size={36} />}
          title="No accounts found"
          description={
            q || status
              ? "No accounts match the current search or filter. Try adjusting them."
              : "No accounts have registered yet."
          }
        />
      ) : (
        <AccountsTable
          accounts={accounts}
          total={total}
          page={page}
          pageSize={PAGE_SIZE}
          query={q}
          status={status}
        />
      )}
    </div>
  );
}
