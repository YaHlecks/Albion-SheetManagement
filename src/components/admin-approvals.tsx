"use client";

import { useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { Check, X } from "lucide-react";
import { Button } from "@/components/ui";
import { useToast } from "@/components/toast";
import { formatDateTime } from "@/lib/utils";

export interface PendingUser {
  id: string;
  ign: string;
  discord: string | null;
  created_at: string;
}

export function ApprovalsList({ initial }: { initial: PendingUser[] }) {
  const [items, setItems] = useState(initial);
  const [busyId, setBusyId] = useState<string | null>(null);
  const [confirmReject, setConfirmReject] = useState<PendingUser | null>(null);
  const router = useRouter();
  const toast = useToast();

  async function act(user: PendingUser, action: "approve_user" | "reject_user") {
    setBusyId(user.id);
    try {
      const res = await fetch("/api/admin/action", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ action, targetUserId: user.id }),
      });
      const json = await res.json().catch(() => ({}));
      if (!res.ok || json.ok === false) {
        toast.error(json.error === "ACTION_FAILED" ? "Action failed. Try again." : "Action rejected.");
        return;
      }
      setItems((prev) => prev.filter((i) => i.id !== user.id));
      toast.success(action === "approve_user" ? `${user.ign} approved.` : `${user.ign} rejected.`);
      router.refresh();
    } catch {
      toast.error("Network error — action not completed.");
    } finally {
      setBusyId(null);
      setConfirmReject(null);
    }
  }

  if (items.length === 0) {
    return (
      <p className="panel py-10 text-center text-sm text-muted">
        All caught up — no pending registrations.
      </p>
    );
  }

  return (
    <div className="space-y-3">
      {items.map((u) => (
        <div key={u.id} className="panel flex flex-wrap items-center justify-between gap-3 p-4">
          <div className="min-w-0">
            <div className="flex items-center gap-2">
              <p className="font-semibold">{u.ign}</p>
              <span className="badge badge-pending">pending</span>
            </div>
            <p className="mt-0.5 text-xs text-faint">
              Registered {formatDateTime(u.created_at)}
              {u.discord ? ` · Discord: ${u.discord}` : ""}
            </p>
          </div>
          <div className="flex items-center gap-2">
            <Link href={`/admin/accounts/${u.id}`} className="btn btn-ghost btn-sm">View</Link>
            <Button
              size="sm"
              variant="secondary"
              onClick={() => void act(u, "reject_user")}
              loading={busyId === u.id}
              disabled={busyId !== null}
              aria-label={`Reject ${u.ign}`}
            >
              <X size={14} /> Reject
            </Button>
            <Button
              size="sm"
              onClick={() => void act(u, "approve_user")}
              loading={busyId === u.id}
              disabled={busyId !== null}
              aria-label={`Approve ${u.ign}`}
            >
              <Check size={14} /> Approve
            </Button>
          </div>
        </div>
      ))}
    </div>
  );
}
