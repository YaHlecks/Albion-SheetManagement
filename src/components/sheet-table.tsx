"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { Lock } from "lucide-react";
import { SaveStateIndicator, SearchInput, Badge } from "@/components/ui";
import { useToast } from "@/components/toast";
import { TEAM_ROLES } from "@/lib/roles";
import { cn } from "@/lib/utils";

export interface SheetMember {
  id: string;
  user_id: string;
  ign: string;
  role: string;
  weapon: string | null;
  availability: string | null;
  notes: string | null;
}

type SaveState = "idle" | "saving" | "saved" | "error";

const EDITABLE_FIELDS = ["role", "weapon", "availability", "notes"] as const;
type EditableField = (typeof EDITABLE_FIELDS)[number];

interface CellState {
  state: SaveState;
  error?: string;
}

export function SheetTable({
  members,
  canEdit,
  isAdmin,
  locked,
  teamStatus,
  currentUserId,
  onReverted,
}: {
  members: SheetMember[];
  canEdit: boolean;
  isAdmin: boolean;
  locked: boolean;
  teamStatus: string;
  currentUserId: string;
  onReverted?: () => void;
}) {
  const toast = useToast();
  const [query, setQuery] = useState("");
  const [cells, setCells] = useState<Record<string, CellState>>({});
  const [revertTarget, setRevertTarget] = useState<{ member: SheetMember; field: EditableField } | null>(null);
  const [revertValue, setRevertValue] = useState("");
  const [revertBusy, setRevertBusy] = useState(false);

  const timers = useRef<Record<string, number>>({});
  const latest = useRef<Record<string, string>>({});

  useEffect(() => {
    return () => {
      Object.values(timers.current).forEach((t) => window.clearTimeout(t));
    };
  }, []);

  const filtered = members.filter((m) =>
    query.trim() === "" ? true : m.ign.toLowerCase().includes(query.trim().toLowerCase())
  );

  const editableRow = useCallback(
    (m: SheetMember) => canEdit && !locked && (isAdmin || m.user_id === currentUserId) && teamStatus !== "archived",
    [canEdit, locked, isAdmin, currentUserId, teamStatus]
  );

  async function save(memberId: string, field: EditableField, value: string) {
    const key = `${memberId}:${field}`;
    setCells((prev) => ({ ...prev, [key]: { state: "saving" } }));

    try {
      const res = await fetch("/api/sheet/update-field", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ memberId, field, value }),
      });
      const json = await res.json().catch(() => ({}));

      if (!res.ok || json.ok === false) {
        const message = mapSaveError(json.error ?? res.status);
        setCells((prev) => ({ ...prev, [key]: { state: "error", error: message } }));
        toast.error(message);
        return;
      }

      setCells((prev) => ({ ...prev, [key]: { state: "saved" } }));
      window.setTimeout(() => {
        setCells((prev) => (prev[key]?.state === "saved" ? { ...prev, [key]: { state: "idle" } } : prev));
      }, 1800);
    } catch {
      const message = "Network error — change not saved.";
      setCells((prev) => ({ ...prev, [key]: { state: "error", error: message } }));
      toast.error(message);
    }
  }

  function onCellChange(memberId: string, field: EditableField, value: string) {
    latest.current[`${memberId}:${field}`] = value;
    const key = `${memberId}:${field}`;
    setCells((prev) => ({ ...prev, [key]: { state: "saving" } }));

    window.clearTimeout(timers.current[key]);
    timers.current[key] = window.setTimeout(() => {
      void save(memberId, field, latest.current[`${memberId}:${field}`] ?? "");
    }, 700);
  }

  function onCellBlur(memberId: string, field: EditableField) {
    const key = `${memberId}:${field}`;
    // Flush a pending debounce immediately when leaving the cell.
    const pending = timers.current[key];
    if (pending) {
      window.clearTimeout(pending);
      delete timers.current[key];
      void save(memberId, field, latest.current[`${memberId}:${field}`] ?? "");
    }
  }

  async function confirmRevert() {
    if (!revertTarget) return;
    setRevertBusy(true);
    try {
      const res = await fetch("/api/admin/revert-field", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          memberId: revertTarget.member.id,
          field: revertTarget.field,
          previousValue: revertValue,
        }),
      });
      const json = await res.json().catch(() => ({}));
      if (!res.ok || json.ok === false) {
        toast.error(mapSaveError(json.error ?? res.status));
        return;
      }
      toast.success("Change reverted.");
      setRevertTarget(null);
      onReverted?.();
    } catch {
      toast.error("Network error — revert failed.");
    } finally {
      setRevertBusy(false);
    }
  }

  return (
    <div className="space-y-3">
      <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
        <SearchInput
          value={query}
          onChange={setQuery}
          placeholder="Search players…"
          className="w-full sm:max-w-xs"
        />
        <div className="flex items-center gap-3">
          <SaveStateIndicator
            state={
              Object.values(cells).some((c) => c.state === "error")
                ? "error"
                : Object.values(cells).some((c) => c.state === "saving")
                  ? "saving"
                  : Object.values(cells).some((c) => c.state === "saved")
                    ? "saved"
                    : "idle"
            }
          />
          {locked ? (
            <span className="badge badge-locked">
              <Lock size={11} /> Sheet locked
            </span>
          ) : null}
        </div>
      </div>

      {locked && !isAdmin ? (
        <div className="form-banner form-banner-warn">
          <Lock size={15} className="mt-0.5 shrink-0" />
          <span>This team sheet has been locked by an administrator. Edits are disabled.</span>
        </div>
      ) : null}

      <div className="table-wrap">
        <table className="data">
          <thead>
            <tr>
              <th>Player</th>
              <th>Role</th>
              <th>Weapon</th>
              <th>Available</th>
              <th>Notes</th>
              {isAdmin ? <th aria-label="Row actions" /> : null}
            </tr>
          </thead>
          <tbody>
            {filtered.length === 0 ? (
              <tr>
                <td colSpan={isAdmin ? 6 : 5} className="py-10 text-center text-muted">
                  {members.length === 0 ? "No members in this team yet." : `No players matching “${query}”.`}
                </td>
              </tr>
            ) : (
              filtered.map((m) => {
                const rowEditable = editableRow(m);
                return (
                  <tr key={m.id}>
                    <td>
                      <div className="flex items-center gap-2">
                        <span className="font-semibold">{m.ign}</span>
                        {m.user_id === currentUserId ? (
                          <span className="badge badge-neutral">you</span>
                        ) : null}
                      </div>
                    </td>
                    <td className="min-w-36">
                      <FieldCell
                        member={m}
                        field="role"
                        value={m.role}
                        type="select"
                        options={[...TEAM_ROLES]}
                        editable={rowEditable}
                        cell={cells[`${m.id}:role`]}
                        onChange={onCellChange}
                        onBlur={onCellBlur}
                      />
                    </td>
                    <td className="min-w-40">
                      <FieldCell
                        member={m}
                        field="weapon"
                        value={m.weapon ?? ""}
                        editable={rowEditable}
                        cell={cells[`${m.id}:weapon`]}
                        onChange={onCellChange}
                        onBlur={onCellBlur}
                        placeholder="—"
                      />
                    </td>
                    <td className="min-w-44">
                      <FieldCell
                        member={m}
                        field="availability"
                        value={m.availability ?? ""}
                        editable={rowEditable}
                        cell={cells[`${m.id}:availability`]}
                        onChange={onCellChange}
                        onBlur={onCellBlur}
                        placeholder="—"
                      />
                    </td>
                    <td className="min-w-52">
                      <FieldCell
                        member={m}
                        field="notes"
                        value={m.notes ?? ""}
                        editable={rowEditable}
                        cell={cells[`${m.id}:notes`]}
                        onChange={onCellChange}
                        onBlur={onCellBlur}
                        placeholder="—"
                      />
                    </td>
                    {isAdmin ? (
                      <td className="text-right">
                        <RowActions
                          member={m}
                          onRevert={(field) => {
                            const current =
                              field === "role" ? m.role : field === "weapon" ? m.weapon : field === "availability" ? m.availability : m.notes;
                            setRevertTarget({ member: m, field });
                            setRevertValue(current ?? "");
                          }}
                        />
                      </td>
                    ) : null}
                  </tr>
                );
              })
            )}
          </tbody>
        </table>
      </div>

      {/* Revert dialog */}
      {revertTarget ? (
        <div className="modal-overlay" role="dialog" aria-modal="true" aria-label="Revert change">
          <div className="modal">
            <div className="p-5">
              <h3 className="font-display text-base font-semibold">Revert {revertTarget.field} for {revertTarget.member.ign}</h3>
              <p className="mt-2 text-sm text-muted">
                Enter the previous value to restore. The change history is preserved and a revert
                event is recorded.
              </p>
              <label className="field-label mt-4" htmlFor="revert-value">Previous value</label>
              {revertTarget.field === "role" ? (
                <select id="revert-value" className="field" value={revertValue} onChange={(e) => setRevertValue(e.target.value)}>
                  {TEAM_ROLES.map((r) => (
                    <option key={r} value={r}>{r}</option>
                  ))}
                </select>
              ) : (
                <input
                  id="revert-value"
                  className="field"
                  value={revertValue}
                  onChange={(e) => setRevertValue(e.target.value)}
                  placeholder="Previous value"
                />
              )}
            </div>
            <div className="flex justify-end gap-2 border-t border-line px-5 py-4">
              <button type="button" className="btn btn-secondary" onClick={() => setRevertTarget(null)} disabled={revertBusy}>
                Cancel
              </button>
              <button type="button" className="btn btn-primary" onClick={confirmRevert} disabled={revertBusy}>
                Revert
              </button>
            </div>
          </div>
        </div>
      ) : null}
    </div>
  );
}

/* ------------------------------ Cells ------------------------------ */

function FieldCell({
  member,
  field,
  value,
  editable,
  cell,
  onChange,
  onBlur,
  type = "text",
  options,
  placeholder,
}: {
  member: SheetMember;
  field: EditableField;
  value: string;
  editable: boolean;
  cell?: CellState;
  onChange: (memberId: string, field: EditableField, value: string) => void;
  onBlur: (memberId: string, field: EditableField) => void;
  type?: "text" | "select";
  options?: string[];
  placeholder?: string;
}) {
  const [local, setLocal] = useState(value);
  useEffect(() => setLocal(value), [value]);

  if (!editable) {
    return <span className="text-muted">{value || placeholder || "—"}</span>;
  }

  const key = `${member.id}:${field}`;
  const cls = cn(
    "cell-edit",
    cell?.state === "saving" && "cell-saving",
    cell?.state === "saved" && "cell-saved",
    cell?.state === "error" && "field-error"
  );

  if (type === "select") {
    return (
      <select
        className={cls}
        value={local}
        aria-label={`${field} for ${member.ign}`}
        onChange={(e) => {
          setLocal(e.target.value);
          onChange(member.id, field, e.target.value);
        }}
        onBlur={() => onBlur(member.id, field)}
      >
        {(options ?? []).map((o) => (
          <option key={o} value={o}>{o}</option>
        ))}
      </select>
    );
  }

  return (
    <input
      className={cls}
      value={local}
      aria-label={`${field} for ${member.ign}`}
      placeholder={placeholder}
      maxLength={field === "notes" ? 300 : field === "availability" ? 200 : 60}
      onChange={(e) => {
        setLocal(e.target.value);
        onChange(member.id, field, e.target.value);
      }}
      onBlur={() => onBlur(member.id, field)}
    />
  );
}

/* --------------------------- Row actions --------------------------- */

function RowActions({ member, onRevert }: { member: SheetMember; onRevert: (field: EditableField) => void }) {
  const [open, setOpen] = useState(false);
  const ref = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!open) return;
    function onDoc(e: MouseEvent) {
      if (ref.current && !ref.current.contains(e.target as Node)) setOpen(false);
    }
    document.addEventListener("mousedown", onDoc);
    return () => document.removeEventListener("mousedown", onDoc);
  }, [open]);

  const fields: { key: EditableField; label: string; hasValue: boolean }[] = [
    { key: "role", label: "Role", hasValue: true },
    { key: "weapon", label: "Weapon", hasValue: Boolean(member.weapon) },
    { key: "availability", label: "Availability", hasValue: Boolean(member.availability) },
    { key: "notes", label: "Notes", hasValue: Boolean(member.notes) },
  ];

  return (
    <div className="relative inline-block" ref={ref}>
      <button
        type="button"
        className="btn btn-ghost btn-sm"
        onClick={() => setOpen((v) => !v)}
        aria-label={`Actions for ${member.ign}`}
        aria-expanded={open}
      >
        ⋯
      </button>
      {open ? (
        <div className="menu right-0" role="menu">
          <p className="section-title px-2 py-1">Revert a field</p>
          {fields.map((f) => (
            <button
              key={f.key}
              type="button"
              role="menuitem"
              className="menu-item"
              disabled={!f.hasValue}
              onClick={() => {
                setOpen(false);
                onRevert(f.key);
              }}
            >
              {f.label}
            </button>
          ))}
        </div>
      ) : null}
    </div>
  );
}

/* --------------------------- Error mapping --------------------------- */

function mapSaveError(code: unknown): string {
  switch (code) {
    case "SHEET_LOCKED":
      return "This sheet has been locked by an administrator.";
    case "FORBIDDEN":
      return "You can only edit your own row.";
    case "ACCOUNT_NOT_APPROVED":
      return "Your account is not approved.";
    case "TEAM_NOT_EDITABLE":
      return "This team sheet is not editable.";
    case "INVALID_FIELD":
      return "Invalid field.";
    case "INVALID_VALUE":
      return "Invalid value for this field.";
    case "NOT_FOUND":
      return "This team member no longer exists.";
    case 401:
      return "Your session has expired. Please sign in again.";
    case 403:
      return "You do not have permission to do that.";
    default:
      return "Save failed. Please try again.";
  }
}
