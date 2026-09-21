"use client";

/**
 * Admin sheet detail (§19): live fill counters (total + per-party), status
 * actions, and per-slot assignment management (assign an approved member or
 * clear). Realtime keeps the counters current during mass prep.
 */
import { useCallback, useEffect, useMemo, useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { Badge, Button, ConfirmDialog, LoadingBlock, Modal } from "@/components/ui";
import { useToast } from "@/components/toast";
import { createBrowserClient } from "@/lib/supabase-browser";
import { MassSheetView } from "@/components/mass-sheet-view";
import {
  adminSetSlotAssignment,
  fetchMassSheet,
  setMassSheetStatus,
  sheetStats,
  subscribeToMassSheet,
  type MassSheetFull,
  type MassSlot,
} from "@/lib/mass";

const STATUS_LABEL: Record<string, string> = {
  draft: "draft", published: "approved", locked: "locked", archived: "archived",
};

interface MemberOption {
  id: string;
  ign: string;
}

export function AdminSheetDetail({ sheetId, initialSheet }: {
  sheetId: string;
  initialSheet: MassSheetFull | null;
}) {
  const router = useRouter();
  const toast = useToast();
  const supabase = createBrowserClient();
  const [sheet, setSheet] = useState<MassSheetFull | null>(initialSheet);
  const [isAdmin, setIsAdmin] = useState(false);
  const [userId, setUserId] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [confirm, setConfirm] = useState<{ next: string; title: string } | null>(null);
  const [assignSlot, setAssignSlot] = useState<MassSlot | null>(null);
  const [members, setMembers] = useState<MemberOption[]>([]);
  const [assignUserId, setAssignUserId] = useState("");
  const [assignIgn, setAssignIgn] = useState("");
  const [assignBusy, setAssignBusy] = useState(false);
  const [loadError, setLoadError] = useState(false);

  const reload = useCallback(async () => {
    try {
      const fresh = await fetchMassSheet(supabase, sheetId);
      setSheet(fresh);
      setLoadError(!fresh);
    } catch {
      setLoadError(true);
    }
  }, [supabase, sheetId]);

  useEffect(() => {
    let active = true;
    void (async () => {
      const { data } = await supabase.auth.getUser();
      if (!active) return;
      setUserId(data.user?.id ?? null);
      if (data.user) {
        const { data: prof } = await supabase
          .from("profiles")
          .select("is_platform_admin")
          .eq("id", data.user.id)
          .maybeSingle();
        if (active) setIsAdmin(Boolean(prof?.is_platform_admin));
      }
    })();
    return () => { active = false; };
  }, [supabase]);

  // Realtime: assignment + status changes (§18/§19).
  useEffect(() => {
    const off = subscribeToMassSheet(supabase, sheetId, (kind) => {
      void reload();
      if (kind === "status") router.refresh();
    });
    return off;
  }, [supabase, sheetId, reload, router]);

  const stats = useMemo(() => sheetStats(sheet), [sheet]);

  const statusActions: Array<{ next: string; label: string; danger?: boolean; confirmTitle: string }> = [];
  if (sheet) {
    if (sheet.status === "draft") statusActions.push({ next: "published", label: "Publish", confirmTitle: "Publish mass sheet?" });
    if (sheet.status === "published") statusActions.push({ next: "locked", label: "Lock", confirmTitle: "Lock mass sheet?" });
    if (sheet.status === "locked") statusActions.push({ next: "published", label: "Unlock", confirmTitle: "Unlock mass sheet?" });
    if (sheet.status !== "archived") statusActions.push({ next: "archived", label: "Archive", danger: true, confirmTitle: "Archive mass sheet?" });
    else statusActions.push({ next: "draft", label: "Restore to draft", confirmTitle: "Restore mass sheet?" });
  }

  const openAssign = async (slot: MassSlot) => {
    setAssignSlot(slot);
    setAssignUserId("");
    setAssignIgn("");
    if (members.length === 0) {
      const team = Array.isArray(sheet?.teams) ? sheet?.teams[0] : sheet?.teams;
      if (!team) return;
      const { data } = await supabase
        .from("team_members")
        .select("profiles ( id, ign )")
        .eq("team_id", team.id);
      setMembers(
        ((data ?? []) as unknown as Array<{ profiles: { id: string; ign: string } | { id: string; ign: string }[] }>)
          .map((row) => {
            const p = Array.isArray(row.profiles) ? row.profiles[0] : row.profiles;
            return p;
          })
          .filter((p): p is { id: string; ign: string } => Boolean(p?.id)),
      );
    }
  };

  const confirmAssign = async () => {
    if (!assignSlot || !assignUserId) return;
    setAssignBusy(true);
    try {
      await adminSetSlotAssignment(supabase, assignSlot.id, assignUserId, assignIgn.trim() || null);
      toast.success("Assignment saved.");
      setAssignSlot(null);
      await reload();
    } catch (err) {
      const code = err instanceof Error && "code" in err ? String((err as { code: unknown }).code) : null;
      toast.error(code === "NO_IGN"
        ? "That member has no IGN on their profile — enter one manually."
        : "Could not save the assignment. Please try again.");
    } finally {
      setAssignBusy(false);
    }
  };

  if (loadError || !sheet) {
    return (
      <div className="panel mt-4 p-6 text-center">
        <p className="font-semibold text-ink">Mass sheet not found</p>
        <p className="mt-1 text-sm text-muted">It may have been deleted, or the link is wrong.</p>
        <Link href="/admin/sheets" className="btn btn-secondary mt-4">Back to Mass Sheets</Link>
      </div>
    );
  }

  const team = Array.isArray(sheet.teams) ? sheet.teams[0] : sheet.teams;

  return (
    <div className="mt-1 space-y-5">
      {/* Header */}
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <div className="flex flex-wrap items-center gap-2">
            <h1 className="font-display text-2xl font-bold tracking-tight">{sheet.title}</h1>
            <Badge status={STATUS_LABEL[sheet.status] ?? "neutral"} />
          </div>
          <p className="mt-1 text-sm text-muted">
            {[sheet.location && `Location: ${sheet.location}`, sheet.set_name && `Set: ${sheet.set_name}`,
              sheet.mass_at && `Massing: ${fmt(sheet.mass_at, sheet.timezone)}`].filter(Boolean).join(" · ")}
          </p>
          <p className="text-xs text-faint">Team: {team?.name ?? "—"}</p>
        </div>
        <div className="flex flex-wrap gap-2">
          <Link href={`/admin/sheets/${sheet.id}/edit`} className="btn btn-secondary">Edit structure</Link>
          {statusActions.map((a) => (
            <Button key={a.next} variant={a.danger ? "outline-danger" : "secondary"} onClick={() => setConfirm({ next: a.next, title: a.confirmTitle })}>
              {a.label}
            </Button>
          ))}
        </div>
      </div>

      {/* Live fill counters (§19) */}
      <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
        <div className="panel p-4">
          <p className="section-title">Total filled</p>
          <p className="mt-1 text-2xl font-bold">{stats.filled} / {stats.total}</p>
          <div className="mt-2 h-1.5 w-full overflow-hidden rounded-full bg-elevated">
            <div className="h-full rounded-full bg-brand transition-all" style={{ width: pct(stats) }} />
          </div>
        </div>
        <div className="panel p-4">
          <p className="section-title">Open slots</p>
          <p className="mt-1 text-2xl font-bold">{stats.open}</p>
        </div>
        {stats.perParty.slice(0, 2).map((p) => (
          <div key={p.partyId} className="panel p-4">
            <p className="section-title">{p.name}</p>
            <p className="mt-1 text-2xl font-bold">{p.filled} / {p.total}</p>
          </div>
        ))}
      </div>

      {sheet.instructions && (
        <div className="panel border-l-4 border-l-brand p-4">
          <p className="section-title">Instructions</p>
          <p className="mt-1 whitespace-pre-wrap text-sm text-muted">{sheet.instructions}</p>
        </div>
      )}

      <MassSheetView
        sheet={sheet}
        currentUserId={userId}
        isAdmin
        editable={false}
        onAction={async (action) => {
          if (action.kind === "clear") {
            try {
              await adminSetSlotAssignment(supabase, action.slot.id, null);
              toast.success("Assignment removed.");
              await reload();
            } catch {
              toast.error("Could not remove the assignment. Please try again.");
            }
          } else if (action.kind === "claim") {
            void openAssign(action.slot);
          } else if (action.kind === "unclaim") {
            void openAssign(action.slot);
          }
        }}
      />

      {/* Assign modal */}
      <Modal open={assignSlot !== null} onClose={() => setAssignSlot(null)} title="Assign member to slot">
        {assignSlot && (
          <div className="space-y-3">
            <p className="text-sm text-muted">
              {assignSlot.role} · <span className="font-mono text-[13px]">{assignSlot.build_name}</span>
              {assignSlot.mass_assignments[0] && (
                <> · currently: <strong>{assignSlot.mass_assignments[0].ign}</strong></>
              )}
            </p>
            <div>
              <label htmlFor="assign-user" className="field-label">Team member</label>
              <select id="assign-user" className="field" value={assignUserId} onChange={(e) => setAssignUserId(e.target.value)}>
                <option value="">Select member…</option>
                {members.map((m) => <option key={m.id} value={m.id}>{m.ign}</option>)}
              </select>
            </div>
            <div>
              <label htmlFor="assign-ign" className="field-label">IGN override (optional)</label>
              <input id="assign-ign" className="field" value={assignIgn} onChange={(e) => setAssignIgn(e.target.value)} maxLength={32} placeholder="Defaults to the member's profile IGN" />
            </div>
            {assignSlot.mass_assignments[0] && (
              <p className="field-hint">Saving reassigns the slot; the previous holder is unassigned and audited.</p>
            )}
            <div className="flex justify-end gap-2 pt-1">
              <Button variant="secondary" onClick={() => setAssignSlot(null)}>Cancel</Button>
              <Button loading={assignBusy} disabled={!assignUserId} onClick={() => void confirmAssign()}>Save assignment</Button>
            </div>
          </div>
        )}
      </Modal>

      <ConfirmDialog
        open={confirm !== null}
        title={confirm?.title ?? ""}
        body={confirm?.next === "published" ? "Members of the team will immediately see the sheet and can claim slots."
          : confirm?.next === "locked" ? "Members can still view the sheet but cannot claim, change or unclaim slots."
          : confirm?.next === "archived" ? "The sheet becomes read-only reference. Members lose access."
          : "The sheet returns to draft — members lose access until you publish again."}
        confirmLabel={confirm?.next === "published" ? "Publish" : confirm?.next === "locked" ? "Lock" : confirm?.next === "archived" ? "Archive" : "Restore"}
        danger={confirm?.next === "archived"}
        busy={busy}
        onCancel={() => setConfirm(null)}
        onConfirm={() => {
          if (!confirm) return;
          setBusy(true);
          void setMassSheetStatus(supabase, sheetId, confirm.next as MassSheetFull["status"])
            .then(() => { toast.success("Status updated."); return reload(); })
            .catch(() => toast.error("Could not update the status. Please try again."))
            .finally(() => { setBusy(false); setConfirm(null); router.refresh(); });
        }}
      />
    </div>
  );
}

function fmt(at: string, tz: string | null): string {
  try {
    return `${new Intl.DateTimeFormat("en-GB", { timeZone: tz || "UTC", dateStyle: "medium", timeStyle: "short" }).format(new Date(at))} (${tz || "UTC"})`;
  } catch {
    return new Date(at).toLocaleString();
  }
}

function pct(stats: { filled: number; total: number }): string {
  return stats.total ? `${Math.round((stats.filled / stats.total) * 100)}%` : "0%";
}
