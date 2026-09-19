"use client";

import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { Lock, Plus, Unlock, UserMinus } from "lucide-react";
import { Button, Modal, SearchInput } from "@/components/ui";
import { useToast } from "@/components/toast";

export interface TeamAdminData {
  id: string;
  name: string;
  status: string;
  sheet_locked: boolean;
}

/** Renders the Add-member button and hosts its modal. */
function AddMemberTrigger({ team }: { team: TeamAdminData }) {
  const [open, setOpen] = useState(false);
  return (
    <>
      <Button size="sm" variant="secondary" onClick={() => setOpen(true)}>
        <Plus size={14} /> Add member
      </Button>
      <AddMemberModal teamId={team.id} open={open} onClose={() => setOpen(false)} />
    </>
  );
}

interface Candidate {
  id: string;
  ign: string;
  status: string;
}

export function TeamAdminControls({ team }: { team: TeamAdminData }) {
  const router = useRouter();
  const toast = useToast();
  const [busy, setBusy] = useState(false);

  async function action(body: Record<string, unknown>, label: string) {
    setBusy(true);
    try {
      const res = await fetch("/api/admin/action", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(body),
      });
      const json = await res.json().catch(() => ({}));
      if (!res.ok || json.ok === false) {
        toast.error(json.error === "USER_NOT_APPROVED" ? "That account is not approved." : `${label} failed.`);
        return;
      }
      toast.success(`${label} done.`);
      router.refresh();
      return true;
    } catch {
      toast.error("Network error.");
      return false;
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="flex flex-wrap items-center gap-2">
      <AddMemberTrigger team={team} />
      {team.sheet_locked ? (
        <Button size="sm" variant="secondary" loading={busy} onClick={() => void action({ action: "unlock_sheet", teamId: team.id }, "Unlock")}>
          <Unlock size={14} /> Unlock sheet
        </Button>
      ) : (
        <Button size="sm" variant="secondary" loading={busy} onClick={() => void action({ action: "lock_sheet", teamId: team.id }, "Lock")}>
          <Lock size={14} /> Lock sheet
        </Button>
      )}
      <RenameTeamButton team={team} busy={busy} onAction={action} />
    </div>
  );
}

function RenameTeamButton({
  team,
  busy,
  onAction,
}: {
  team: TeamAdminData;
  busy: boolean;
  onAction: (body: Record<string, unknown>, label: string) => Promise<boolean | undefined>;
}) {
  const [open, setOpen] = useState(false);
  const [name, setName] = useState(team.name);
  const toast = useToast();

  return (
    <>
      <Button size="sm" variant="ghost" onClick={() => setOpen(true)}>Rename</Button>
      <Modal open={open} title="Rename team" onClose={() => setOpen(false)}>
        <div className="space-y-4">
          <div>
            <label htmlFor="rename-team" className="field-label">Team name</label>
            <input id="rename-team" className="field" value={name} onChange={(e) => setName(e.target.value)} maxLength={60} autoFocus />
          </div>
          <div className="flex justify-end gap-2">
            <Button variant="secondary" onClick={() => setOpen(false)}>Cancel</Button>
            <Button
              loading={busy}
              onClick={async () => {
                if (name.trim().length < 2) {
                  toast.error("Name must be at least 2 characters.");
                  return;
                }
                const ok = await onAction({ action: "rename_team", teamId: team.id, payload: { name: name.trim() } }, "Rename");
                if (ok) setOpen(false);
              }}
            >
              Save
            </Button>
          </div>
        </div>
      </Modal>
    </>
  );
}

export function AddMemberModal({
  teamId,
  open,
  onClose,
  onAdded,
}: {
  teamId: string;
  open: boolean;
  onClose: () => void;
  onAdded?: () => void;
}) {
  const router = useRouter();
  const toast = useToast();
  const [query, setQuery] = useState("");
  const [candidates, setCandidates] = useState<Candidate[]>([]);
  const [loading, setLoading] = useState(false);
  const [role, setRole] = useState("DPS");
  const [adding, setAdding] = useState<string | null>(null);

  useEffect(() => {
    if (!open) return;
    let cancelled = false;
    setLoading(true);
    const t = window.setTimeout(async () => {
      try {
        const res = await fetch(`/api/admin/search-users?q=${encodeURIComponent(query)}`);
        const json = await res.json().catch(() => ({ users: [] }));
        if (!cancelled) setCandidates(json.users ?? []);
      } finally {
        if (!cancelled) setLoading(false);
      }
    }, 250);
    return () => {
      cancelled = true;
      window.clearTimeout(t);
    };
  }, [query, open]);

  async function addUser(userId: string) {
    setAdding(userId);
    try {
      const res = await fetch("/api/admin/action", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ action: "add_member", teamId, targetUserId: userId, payload: { role } }),
      });
      const json = await res.json().catch(() => ({}));
      if (!res.ok || json.ok === false) {
        const map: Record<string, string> = {
          ALREADY_MEMBER: "Already a member of this team.",
          USER_NOT_APPROVED: "Account is not approved yet.",
          USER_NOT_FOUND: "User not found.",
        };
        toast.error(map[json.error] ?? "Could not add the member.");
        return;
      }
      toast.success("Member added and notified.");
      setCandidates((prev) => prev.filter((c) => c.id !== userId));
      router.refresh();
      onAdded?.();
    } catch {
      toast.error("Network error — member not added.");
    } finally {
      setAdding(null);
    }
  }

  return (
    <Modal open={open} title="Add member to team" onClose={onClose} wide>
      <div className="space-y-4">
        <div className="flex flex-col gap-3 sm:flex-row">
          <SearchInput value={query} onChange={setQuery} placeholder="Search approved users by IGN…" className="flex-1" />
          <select className="field sm:w-36" value={role} onChange={(e) => setRole(e.target.value)} aria-label="Role">
            {["Tank", "Healer", "DPS", "Support", "Leader"].map((r) => (
              <option key={r} value={r}>{r}</option>
            ))}
          </select>
        </div>

        <div className="max-h-72 overflow-y-auto rounded-lg border border-line">
          {loading ? (
            <p className="py-8 text-center text-sm text-muted">Searching…</p>
          ) : candidates.length === 0 ? (
            <p className="py-8 text-center text-sm text-muted">
              {query ? "No matching approved users." : "Type to search approved accounts."}
            </p>
          ) : (
            candidates.map((c) => (
              <div key={c.id} className="flex items-center justify-between gap-3 border-b border-line px-4 py-2.5 last:border-b-0">
                <div className="min-w-0">
                  <p className="truncate text-sm font-semibold">{c.ign}</p>
                  <p className="text-xs text-faint">status: {c.status}</p>
                </div>
                <Button size="sm" loading={adding === c.id} disabled={adding !== null} onClick={() => void addUser(c.id)}>
                  Add
                </Button>
              </div>
            ))
          )}
        </div>
      </div>
    </Modal>
  );
}

export function MemberRemoveButton({ memberId, ign }: { memberId: string; ign: string }) {
  const router = useRouter();
  const toast = useToast();
  const [busy, setBusy] = useState(false);
  const [confirming, setConfirming] = useState(false);

  async function remove() {
    setBusy(true);
    try {
      const res = await fetch("/api/admin/action", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ action: "remove_member", memberId }),
      });
      const json = await res.json().catch(() => ({}));
      if (!res.ok || json.ok === false) {
        toast.error("Could not remove the member.");
        return;
      }
      toast.success(`${ign} removed from the team.`);
      router.refresh();
    } catch {
      toast.error("Network error.");
    } finally {
      setBusy(false);
      setConfirming(false);
    }
  }

  return (
    <>
      <Button size="sm" variant="outline-danger" onClick={() => setConfirming(true)} aria-label={`Remove ${ign}`}>
        <UserMinus size={13} />
      </Button>
      {confirming ? (
        <Modal open title={`Remove ${ign}?`} onClose={() => setConfirming(false)}>
          <p className="text-sm text-muted">
            {ign} will lose access to this team sheet. Their past edits remain in the activity log.
          </p>
          <div className="mt-5 flex justify-end gap-2">
            <Button variant="secondary" onClick={() => setConfirming(false)} disabled={busy}>Cancel</Button>
            <Button variant="danger" loading={busy} onClick={() => void remove()}>Remove member</Button>
          </div>
        </Modal>
      ) : null}
    </>
  );
}
