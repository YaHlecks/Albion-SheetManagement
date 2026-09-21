"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { MoreHorizontal } from "lucide-react";
import { ConfirmDialog, Dropdown } from "@/components/ui";
import { useToast } from "@/components/toast";

export interface AccountActionsData {
  id: string;
  ign: string;
  status: string;
  isPlatformAdmin: boolean;
}

export function AccountActions({ account }: { account: AccountActionsData }) {
  const router = useRouter();
  const toast = useToast();
  const [busy, setBusy] = useState(false);
  const [confirm, setConfirm] = useState<{ title: string; body: string; confirmLabel: string; action: string; payload?: Record<string, unknown>; danger?: boolean } | null>(null);

  async function runAction(
    action: string,
    targetUserId: string,
    payload?: Record<string, unknown>
  ) {
    setBusy(true);
    try {
      const res = await fetch("/api/admin/action", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ action, targetUserId, payload }),
      });
      const json = await res.json().catch(() => ({}));
      if (!res.ok || json.ok === false) {
        toast.error("Action failed. Please try again.");
        return;
      }
      toast.success("Done.");
      router.refresh();
    } catch {
      toast.error("Network error — action not completed.");
    } finally {
      setBusy(false);
      setConfirm(null);
    }
  }

  const s = account.status;

  return (
    <>
      <Dropdown
        trigger={<span className="inline-flex items-center gap-1.5"><MoreHorizontal size={15} /> Actions</span>}
        buttonClass="btn btn-secondary btn-sm"
      >
        {(close) => (
          <>
            {s === "pending" ? (
              <>
                <button type="button" role="menuitem" className="menu-item" disabled={busy}
                  onClick={() => { close(); setConfirm({ title: `Approve ${account.ign}?`, body: "The account will gain access to events and can sign up for masses.", confirmLabel: "Approve", action: "approve_user" }); }}>
                  Approve account
                </button>
                <button type="button" role="menuitem" className="menu-item menu-item-danger" disabled={busy}
                  onClick={() => { close(); setConfirm({ title: `Reject ${account.ign}?`, body: "The registration will be rejected. The account will remain unable to log in.", confirmLabel: "Reject", action: "reject_user", danger: true }); }}>
                  Reject registration
                </button>
              </>
            ) : null}
            {s === "approved" ? (
              <button type="button" role="menuitem" className="menu-item menu-item-danger" disabled={busy}
                onClick={() => { close(); setConfirm({ title: `Suspend ${account.ign}?`, body: "The member will immediately lose the ability to edit sheets or access protected pages. History is preserved.", confirmLabel: "Suspend", action: "suspend_user", danger: true }); }}>
                Suspend account
              </button>
            ) : null}
            {s === "suspended" ? (
              <button type="button" role="menuitem" className="menu-item" disabled={busy}
                onClick={() => { close(); setConfirm({ title: `Reactivate ${account.ign}?`, body: "The account will regain approved access.", confirmLabel: "Reactivate", action: "reactivate_user" }); }}>
                Reactivate account
              </button>
            ) : null}
            {s === "rejected" || s === "archived" ? (
              <button type="button" role="menuitem" className="menu-item" disabled={busy}
                onClick={() => { close(); setConfirm({ title: `Approve ${account.ign}?`, body: "The account will regain approved access.", confirmLabel: "Approve", action: "approve_user" }); }}>
                Approve account
              </button>
            ) : null}
            {s !== "archived" ? (
              <button type="button" role="menuitem" className="menu-item menu-item-danger" disabled={busy}
                onClick={() => { close(); setConfirm({ title: `Archive ${account.ign}?`, body: "The account is soft-deleted: it can no longer log in, but all history and audit records are preserved.", confirmLabel: "Archive", action: "archive_user", danger: true }); }}>
                Archive account
              </button>
            ) : null}
            <div className="menu-sep" />
            <button
              type="button"
              role="menuitem"
              className="menu-item"
              disabled={busy}
              onClick={() => {
                close();
                const next = !account.isPlatformAdmin;
                setConfirm({
                  title: next ? `Grant admin to ${account.ign}?` : `Revoke admin from ${account.ign}?`,
                  body: next
                    ? "This user will have full administrative access."
                    : "This user will lose administrative access. You cannot revoke your own admin via this menu.",
                  confirmLabel: next ? "Grant admin" : "Revoke admin",
                  action: "set_admin",
                  payload: { is_admin: next },
                });
              }}
            >
              {account.isPlatformAdmin ? "Revoke admin" : "Grant admin"}
            </button>
          </>
        )}
      </Dropdown>

      {confirm ? (
        <ConfirmDialog
          open
          title={confirm.title}
          body={confirm.body}
          confirmLabel={confirm.confirmLabel}
          danger={confirm.danger}
          busy={busy}
          onCancel={() => setConfirm(null)}
          onConfirm={() => void runAction(confirm.action, account.id, confirm.payload)}
        />
      ) : null}
    </>
  );
}
