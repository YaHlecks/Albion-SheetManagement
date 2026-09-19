"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { Badge, Button } from "@/components/ui";
import { MemberRemoveButton } from "@/components/admin-team-detail";
import { useToast } from "@/components/toast";

export interface AdminMemberRow {
  id: string;
  user_id: string;
  ign: string;
  role: string;
  joined_at: string;
}

export function AdminMemberTable({ members, teamId }: { members: AdminMemberRow[]; teamId: string }) {
  const router = useRouter();
  const toast = useToast();
  const [busyId, setBusyId] = useState<string | null>(null);

  async function changeRole(memberId: string, role: string) {
    setBusyId(memberId);
    try {
      const res = await fetch("/api/admin/action", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ action: "set_member_role", memberId, payload: { role } }),
      });
      const json = await res.json().catch(() => ({}));
      if (!res.ok || json.ok === false) {
        toast.error("Could not change the role.");
        return;
      }
      toast.success("Role updated.");
      router.refresh();
    } catch {
      toast.error("Network error.");
    } finally {
      setBusyId(null);
    }
  }

  if (members.length === 0) {
    return (
      <p className="panel py-8 text-center text-sm text-muted">
        No members yet. Use “Add member” to assign approved accounts.
      </p>
    );
  }

  return (
    <div className="table-wrap">
      <table className="data">
        <thead>
          <tr>
            <th>Member</th>
            <th>Role</th>
            <th>Joined</th>
            <th aria-label="Actions" className="text-right">Manage</th>
          </tr>
        </thead>
        <tbody>
          {members.map((m) => (
            <tr key={m.id}>
              <td className="font-semibold">{m.ign}</td>
              <td>
                <select
                  className="field h-8 w-32 text-[13px]"
                  value={m.role}
                  disabled={busyId === m.id}
                  onChange={(e) => void changeRole(m.id, e.target.value)}
                  aria-label={`Role for ${m.ign}`}
                >
                  {["Tank", "Healer", "DPS", "Support", "Leader"].map((r) => (
                    <option key={r} value={r}>{r}</option>
                  ))}
                </select>
              </td>
              <td className="text-muted">{new Date(m.joined_at).toLocaleDateString("en-GB")}</td>
              <td className="text-right">
                <MemberRemoveButton memberId={m.id} ign={m.ign} />
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}
