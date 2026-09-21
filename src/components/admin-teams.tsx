"use client";

import { useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { Lock, Plus, Unlock } from "lucide-react";
import { Badge, Button, Modal } from "@/components/ui";
import { useToast } from "@/components/toast";
import { formatDate } from "@/lib/utils";

export interface AdminTeamRow {
  id: string;
  name: string;
  description: string | null;
  status: string;
  sheet_locked: boolean;
  created_at: string;
  memberCount: number;
}

export function AdminTeamsClient({ teams: initialTeams }: { teams: AdminTeamRow[] }) {
  const [teams, setTeams] = useState(initialTeams);
  const [createOpen, setCreateOpen] = useState(false);
  const [name, setName] = useState("");
  const [description, setDescription] = useState("");
  const [creating, setCreating] = useState(false);
  const [busyId, setBusyId] = useState<string | null>(null);
  const router = useRouter();
  const toast = useToast();

  async function createTeam() {
    if (name.trim().length < 2 || name.trim().length > 60) {
      toast.error("Team name must be 2–60 characters.");
      return;
    }
    setCreating(true);
    try {
      const res = await fetch("/api/admin/action", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          action: "create_team",
          payload: { name: name.trim(), description: description.trim(), status: "open" },
        }),
      });
      const json = await res.json().catch(() => ({}));
      if (!res.ok || json.ok === false) {
        // Surface the database's actual verdict — never a generic guess.
        const code = typeof json?.error === "string" ? json.error : null;
        toast.error(
          code === "NAME_TAKEN" ? "A team with that name already exists."
          : code === "INVALID_TEAM_NAME" ? "Team name must be 2–60 characters."
          : code === "INVALID_STATUS" ? "Invalid team status."
          : code === "FORBIDDEN" ? "Your account is not an admin in the database (profiles.is_platform_admin). Re-run migrations or fix your profile."
          : code === "UNKNOWN_ACTION" ? "Database function missing — run: npm run db:push"
          : "Could not create the team. Please try again."
        );
        return;
      }
      toast.success("✓ Team created successfully");
      setCreateOpen(false);
      setName("");
      setDescription("");
      router.refresh();
    } catch {
      toast.error("Network error — team not created.");
    } finally {
      setCreating(false);
    }
  }

  async function teamAction(teamId: string, action: string, label: string) {
    setBusyId(teamId);
    try {
      const res = await fetch("/api/admin/action", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ action, teamId }),
      });
      const json = await res.json().catch(() => ({}));
      if (!res.ok || json.ok === false) {
        toast.error(`${label} failed.`);
        return;
      }
      toast.success(`${label} done.`);
      router.refresh();
    } catch {
      toast.error("Network error.");
    } finally {
      setBusyId(null);
    }
  }

  return (
    <div className="space-y-4">
      <div className="flex justify-end">
        <Button onClick={() => setCreateOpen(true)}><Plus size={15} /> New team</Button>
      </div>

      <div className="grid gap-3 md:grid-cols-2 lg:grid-cols-3">
        {teams.map((t) => (
          <div key={t.id} className="panel p-5">
            <div className="flex items-start justify-between gap-2">
              <div className="min-w-0">
                <Link href={`/admin/teams/${t.id}`} className="font-display text-base font-semibold hover:text-brand">
                  {t.name}
                </Link>
                <p className="mt-0.5 line-clamp-1 text-xs text-faint">{t.description || "No description"}</p>
              </div>
              <Badge status={t.status} />
            </div>
            <p className="mt-3 text-sm text-muted">{t.memberCount} members · created {formatDate(t.created_at)}</p>
            <div className="mt-4 flex flex-wrap items-center gap-2">
              <Link href={`/admin/teams/${t.id}`} className="btn btn-secondary btn-sm">Manage</Link>
              {t.sheet_locked ? (
                <Button size="sm" variant="secondary" loading={busyId === t.id} onClick={() => void teamAction(t.id, "unlock_sheet", "Unlock")}>
                  <Unlock size={13} /> Unlock
                </Button>
              ) : (
                <Button size="sm" variant="secondary" loading={busyId === t.id} onClick={() => void teamAction(t.id, "lock_sheet", "Lock")}>
                  <Lock size={13} /> Lock
                </Button>
              )}
              {t.status !== "archived" ? (
                <Button size="sm" variant="outline-danger" loading={busyId === t.id} onClick={() => void teamAction(t.id, "archive_team", "Archive")}>
                  Archive
                </Button>
              ) : (
                <Button size="sm" variant="secondary" loading={busyId === t.id} onClick={() => void teamAction(t.id, "restore_team", "Restore")}>
                  Restore
                </Button>
              )}
            </div>
          </div>
        ))}
      </div>

      <Modal open={createOpen} title="Create a new team" onClose={() => setCreateOpen(false)}>
        <div className="space-y-4">
          <div>
            <label htmlFor="team-name" className="field-label">Team name *</label>
            <input
              id="team-name"
              className="field"
              value={name}
              onChange={(e) => setName(e.target.value)}
              placeholder="e.g. Team Alpha"
              maxLength={60}
              autoFocus
            />
          </div>
          <div>
            <label htmlFor="team-desc" className="field-label">Description</label>
            <textarea
              id="team-desc"
              className="field"
              value={description}
              onChange={(e) => setDescription(e.target.value)}
              placeholder="What is this team for?"
              maxLength={500}
              rows={3}
            />
          </div>
          <div className="flex justify-end gap-2">
            <Button variant="secondary" onClick={() => setCreateOpen(false)} disabled={creating}>Cancel</Button>
            <Button onClick={() => void createTeam()} loading={creating}>Create team</Button>
          </div>
        </div>
      </Modal>
    </div>
  );
}
