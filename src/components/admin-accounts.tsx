"use client";

import { useRouter, useSearchParams } from "next/navigation";
import { useCallback } from "react";
import Link from "next/link";
import { Badge, Pagination, SearchInput } from "@/components/ui";
import { formatDateTime, timeAgo } from "@/lib/utils";

export interface AccountRow {
  id: string;
  ign: string;
  discord: string | null;
  status: string;
  is_platform_admin: boolean;
  created_at: string;
  last_login_at: string | null;
}

const STATUSES = ["", "pending", "approved", "rejected", "suspended", "archived"];

export function AccountsTable({
  accounts,
  total,
  page,
  pageSize,
  query,
  status,
}: {
  accounts: AccountRow[];
  total: number;
  page: number;
  pageSize: number;
  query: string;
  status: string;
}) {
  const router = useRouter();
  const params = useSearchParams();

  const update = useCallback(
    (patch: Record<string, string>) => {
      const next = new URLSearchParams(params.toString());
      for (const [k, v] of Object.entries(patch)) {
        if (v) next.set(k, v);
        else next.delete(k);
      }
      if (!("page" in patch)) next.delete("page");
      router.replace(`/admin/accounts?${next.toString()}`);
    },
    [params, router]
  );

  const pageCount = Math.max(1, Math.ceil(total / pageSize));

  return (
    <div className="space-y-4">
      <div className="flex flex-col gap-3 sm:flex-row sm:items-center">
        <SearchInput
          value={query}
          onChange={(v) => update({ q: v })}
          placeholder="Search by IGN…"
          className="sm:max-w-xs"
        />
        <select
          className="field sm:w-44"
          value={status}
          onChange={(e) => update({ status: e.target.value })}
          aria-label="Filter by status"
        >
          <option value="">All statuses</option>
          {STATUSES.filter(Boolean).map((s) => (
            <option key={s} value={s}>{s}</option>
          ))}
        </select>
        <p className="text-xs text-faint sm:ml-auto">{total} accounts</p>
      </div>

      <div className="table-wrap">
        <table className="data">
          <thead>
            <tr>
              <th>Member</th>
              <th>Status</th>
              <th>Discord</th>
              <th>Registered</th>
              <th>Last login</th>
              <th aria-label="Actions" />
            </tr>
          </thead>
          <tbody>
            {accounts.map((a) => (
              <tr key={a.id}>
                <td>
                  <Link href={`/admin/accounts/${a.id}`} className="table-link">
                    {a.ign}
                  </Link>
                  {a.is_platform_admin ? <span className="badge badge-admin ml-2">admin</span> : null}
                </td>
                <td><Badge status={a.status} /></td>
                <td className="text-muted">{a.discord || "—"}</td>
                <td className="text-muted">{formatDateTime(a.created_at)}</td>
                <td className="text-muted">{a.last_login_at ? timeAgo(a.last_login_at) : "Never"}</td>
                <td className="text-right">
                  <Link href={`/admin/accounts/${a.id}`} className="btn btn-secondary btn-sm">Manage</Link>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      <Pagination page={page} pageCount={pageCount} onPage={(p) => update({ page: String(p) })} />
    </div>
  );
}
