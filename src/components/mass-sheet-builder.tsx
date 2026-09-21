"use client";

/**
 * Mass sheet builder — used by BOTH the create wizard and admin edit mode.
 * All structural edits happen on a local draft; "Save draft" sends the whole
 * structure in one save_mass_sheet RPC call (atomic, preserves assignments
 * on untouched slots). Delete confirmations warn when a slot holds an
 * assignment (§24/§36).
 */
import { useMemo, useState } from "react";
import { Badge, Button, ConfirmDialog, Modal } from "@/components/ui";
import { EquipmentPicker } from "@/components/equipment-picker";
import { MassSheetPreview } from "@/components/mass-sheet-preview";
import { composeMassAt, type SlotPriority } from "@/lib/mass";
import { ALBION_BUILDS, ALBION_ROLES, FILL_NOTES, TIMEZONES } from "@/lib/mass-constants";

const STEPS = ["Mass information", "Parties", "Slots & builds", "Team", "Preview"] as const;

export interface BuilderSlot {
  id?: string;
  role: string;
  build_name: string;
  priority: SlotPriority;
  notes: string;
  required: boolean;
  /** Structured tier handling (Phase 26): 'any' | T4 … T8.1 */
  tier_requirement?: string;
  /** Existing assignment on an existing slot — used for delete warnings (§24). */
  assignedIgn?: string | null;
}

export interface BuilderParty {
  id?: string;
  name: string;
  fill_note: string;
  slots: BuilderSlot[];
}

export interface BuilderState {
  title: string;
  location: string;
  set_name: string;
  /** Local date "YYYY-MM-DD" + "HH:mm" + IANA tz; converted to UTC on save. */
  mass_date: string;
  mass_time: string;
  timezone: string;
  description: string;
  instructions: string;
  team_id: string;
  parties: BuilderParty[];
}

export function emptySheet(teamId = ""): BuilderState {
  return {
    title: "",
    location: "",
    set_name: "",
    mass_date: "",
    mass_time: "",
    timezone: "UTC",
    description: "",
    instructions: "",
    team_id: teamId,
    parties: [{ name: "Party 1", fill_note: "", slots: [] }],
  };
}

export function draftFromSheet(sheet: {
  title: string;
  location: string | null;
  set_name: string | null;
  mass_at: string | null;
  timezone: string | null;
  description: string | null;
  instructions: string | null;
  team_id: string;
  mass_parties: Array<{
    id: string;
    name: string;
    fill_note: string | null;
    sort_order: number;
    mass_slots: Array<{
      id: string;
      role: string;
      build_name: string;
      priority: string;
      notes: string | null;
      required: boolean;
      sort_order: number;
      mass_assignments: Array<{ ign: string }>;
    }>;
  }>;
}): BuilderState {
  // mass_at (UTC instant) → local wall-clock in the sheet's timezone for editing.
  let d = "", t = "";
  if (sheet.mass_at) {
    try {
      const parts = new Intl.DateTimeFormat("en-CA", {
        timeZone: sheet.timezone || "UTC",
        year: "numeric", month: "2-digit", day: "2-digit",
        hour: "2-digit", minute: "2-digit", hour12: false,
      }).formatToParts(new Date(sheet.mass_at));
      const g = (ty: string) => parts.find((p) => p.type === ty)?.value ?? "";
      d = `${g("year")}-${g("month")}-${g("day")}`;
      t = `${g("hour") === "24" ? "00" : g("hour")}:${g("minute")}`;
    } catch { /* leave blank */ }
  }
  return {
    title: sheet.title,
    location: sheet.location ?? "",
    set_name: sheet.set_name ?? "",
    mass_date: d,
    mass_time: t,
    timezone: sheet.timezone || "UTC",
    description: sheet.description ?? "",
    instructions: sheet.instructions ?? "",
    team_id: sheet.team_id,
    parties: sheet.mass_parties.map((p) => ({
      id: p.id,
      name: p.name,
      fill_note: p.fill_note ?? "",
      slots: p.mass_slots.map((s) => ({
        id: s.id,
        role: s.role,
        build_name: s.build_name,
        priority: s.priority as SlotPriority,
        notes: s.notes ?? "",
        required: s.required,
        tier_requirement: (s as { tier_requirement?: string }).tier_requirement ?? "any",
        assignedIgn: s.mass_assignments[0]?.ign ?? null,
      })),
    })),
  };
}

interface BuilderProps {
  state: BuilderState;
  onChange: (next: BuilderState) => void;
  teams: Array<{ id: string; name: string }>;
  busy: boolean;
  onSave: (s: BuilderState) => void;
  onCancel: () => void;
  saveLabel?: string;
}

export function MassSheetBuilder({ state, onChange, teams, busy, onSave, onCancel, saveLabel = "Save draft" }: BuilderProps) {
  const [step, setStep] = useState(0);
  const [deleteParty, setDeleteParty] = useState<number | null>(null);
  const [deleteSlot, setDeleteSlot] = useState<{ party: number; slot: number } | null>(null);
  const [pickerSlot, setPickerSlot] = useState<{ party: number; slot: number } | null>(null);

  const set = (patch: Partial<BuilderState>) => onChange({ ...state, ...patch });

  const setParty = (i: number, patch: Partial<BuilderParty>) => {
    set({ parties: state.parties.map((p, idx) => (idx === i ? { ...p, ...patch } : p)) });
  };

  const addParty = () => {
    if (state.parties.length >= 10) return;
    set({ parties: [...state.parties, { name: `Party ${state.parties.length + 1}`, fill_note: "", slots: [] }] });
  };

  const duplicateParty = (i: number) => {
    if (state.parties.length >= 10) return;
    const src = state.parties[i];
    const copy: BuilderParty = {
      name: `${src.name} (copy)`,
      fill_note: src.fill_note,
      // Copies lose DB ids and assignments — fresh slots (§26 semantics).
      slots: src.slots.map((s) => ({ ...s, id: undefined, assignedIgn: null })),
    };
    const parties = [...state.parties];
    parties.splice(i + 1, 0, copy);
    set({ parties });
  };

  const removeParty = (i: number) => {
    set({ parties: state.parties.filter((_, idx) => idx !== i) });
    setDeleteParty(null);
  };

  const addSlot = (pi: number) => {
    setParty(pi, {
      slots: [...state.parties[pi].slots, { role: "DPS", build_name: "", priority: "normal", required: true, notes: "" }],
    });
  };

  const setSlot = (pi: number, si: number, patch: Partial<BuilderSlot>) => {
    const party = state.parties[pi];
    setParty(pi, { slots: party.slots.map((s, idx) => (idx === si ? { ...s, ...patch } : s)) });
  };

  const removeSlot = (pi: number, si: number) => {
    setParty(pi, { slots: state.parties[pi].slots.filter((_, idx) => idx !== si) });
    setDeleteSlot(null);
  };

  const moveSlot = (pi: number, si: number, dir: -1 | 1) => {
    const party = state.parties[pi];
    const j = si + dir;
    if (j < 0 || j >= party.slots.length) return;
    const slots = [...party.slots];
    [slots[si], slots[j]] = [slots[j], slots[si]];
    setParty(pi, { slots });
  };

  const massAt = useMemo(
    () => composeMassAt(state.mass_date, state.mass_time, state.timezone),
    [state.mass_date, state.mass_time, state.timezone],
  );
  const massAtLabel = massAt
    ? new Intl.DateTimeFormat("en-GB", {
        timeZone: state.timezone, dateStyle: "medium", timeStyle: "short",
      }).format(new Date(massAt))
    : "";

  const totalSlots = state.parties.reduce((n, p) => n + p.slots.length, 0);
  const canSave = state.title.trim().length >= 2 && Boolean(state.team_id) && totalSlots > 0;

  return (
    <div className="space-y-4">
      {/* Step indicator */}
      <ol className="flex flex-wrap gap-1 text-xs">
        {STEPS.map((label, i) => (
          <li key={label}>
            <button
              type="button"
              onClick={() => setStep(i)}
              className={i === step ? "badge badge-admin" : "badge badge-neutral"}
              aria-current={i === step ? "step" : undefined}
            >
              {i + 1}. {label}
            </button>
          </li>
        ))}
      </ol>

      {/* STEP 1 — mass information (§7) */}
      {step === 0 && (
        <div className="panel grid gap-3 p-4 sm:grid-cols-2">
          <div className="sm:col-span-2">
            <label htmlFor="ms-title" className="field-label">Mass name *</label>
            <input id="ms-title" className="field" value={state.title} onChange={(e) => set({ title: e.target.value })} placeholder="Martlock Portal 1+1" maxLength={120} />
          </div>
          <div>
            <label htmlFor="ms-location" className="field-label">Location</label>
            <input id="ms-location" className="field" value={state.location} onChange={(e) => set({ location: e.target.value })} placeholder="MARTLOCK PORTAL" maxLength={120} />
          </div>
          <div>
            <label htmlFor="ms-set" className="field-label">Set</label>
            <input id="ms-set" className="field" value={state.set_name} onChange={(e) => set({ set_name: e.target.value })} placeholder="1+1" maxLength={60} />
          </div>
          <div>
            <label htmlFor="ms-date" className="field-label">Massing date</label>
            <input id="ms-date" type="date" className="field" value={state.mass_date} onChange={(e) => set({ mass_date: e.target.value })} />
          </div>
          <div>
            <label htmlFor="ms-time" className="field-label">Massing time</label>
            <input id="ms-time" type="time" className="field" value={state.mass_time} onChange={(e) => set({ mass_time: e.target.value })} />
          </div>
          <div>
            <label htmlFor="ms-tz" className="field-label">Timezone</label>
            <select id="ms-tz" className="field" value={state.timezone} onChange={(e) => set({ timezone: e.target.value })}>
              {TIMEZONES.map((tz) => <option key={tz} value={tz}>{tz}</option>)}
            </select>
            {massAt && <p className="field-hint">Stored as UTC: {new Date(massAt).toISOString()}</p>}
          </div>
          <div className="sm:col-span-2">
            <label htmlFor="ms-desc" className="field-label">Description</label>
            <textarea id="ms-desc" className="field" rows={2} value={state.description} onChange={(e) => set({ description: e.target.value })} maxLength={1000} />
          </div>
          <div className="sm:col-span-2">
            <label htmlFor="ms-instr" className="field-label">Instructions (shown to members)</label>
            <textarea id="ms-instr" className="field" rows={3} value={state.instructions} onChange={(e) => set({ instructions: e.target.value })} placeholder="Fill Party 1 first before Party 2…" maxLength={2000} />
          </div>
        </div>
      )}

      {/* STEP 2 — party builder (§8) */}
      {step === 1 && (
        <div className="space-y-3">
          {state.parties.map((party, pi) => (
            <div key={pi} className="panel p-3">
              <div className="flex flex-wrap items-center gap-2">
                <input
                  className="field sm:w-52"
                  value={party.name}
                  onChange={(e) => setParty(pi, { name: e.target.value })}
                  aria-label={`Party ${pi + 1} name`}
                  maxLength={80}
                />
                <select
                  className="field sm:w-60"
                  value={party.fill_note}
                  onChange={(e) => setParty(pi, { fill_note: e.target.value })}
                  aria-label="Fill note"
                >
                  <option value="">No fill note</option>
                  {FILL_NOTES.map((n) => <option key={n} value={n}>{n}</option>)}
                </select>
                <div className="ml-auto flex gap-1">
                  <Button type="button" size="sm" variant="ghost" onClick={() => duplicateParty(pi)}>Duplicate</Button>
                  <Button type="button" size="sm" variant="outline-danger" onClick={() => setDeleteParty(pi)}>Delete</Button>
                </div>
              </div>
              <p className="field-hint">{party.slots.length} slot(s)</p>
            </div>
          ))}
          <Button type="button" variant="secondary" onClick={addParty} disabled={state.parties.length >= 10}>+ Add party</Button>
        </div>
      )}

      {/* STEP 3 — slots & builds (§9/§10) */}
      {step === 2 && (
        <div className="space-y-3">
          {state.parties.map((party, pi) => (
            <div key={pi} className="panel p-3">
              <h3 className="section-title mb-2">{party.name}</h3>
              <div className="space-y-2">
                {party.slots.map((slot, si) => (
                  <div key={si} className="flex flex-wrap items-end gap-2 rounded-lg bg-elevated/60 p-2">
                    <div>
                      <label htmlFor={`slot-role-${pi}-${si}`} className="field-label">Role</label>
                      <input id={`slot-role-${pi}-${si}`} list="albion-roles" className="field sm:w-32" value={slot.role} onChange={(e) => setSlot(pi, si, { role: e.target.value })} maxLength={40} />
                    </div>
                    <div>
                      <label htmlFor={`slot-build-${pi}-${si}`} className="field-label">Build / weapon</label>
                      <div className="flex gap-1">
                        <input id={`slot-build-${pi}-${si}`} list="albion-builds" className="field sm:w-44" value={slot.build_name} onChange={(e) => setSlot(pi, si, { build_name: e.target.value })} maxLength={80} />
                        <Button type="button" size="sm" variant="secondary" className="h-10" onClick={() => setPickerSlot({ party: pi, slot: si })} aria-label="Browse Albion equipment">
                          Browse
                        </Button>
                      </div>
                      {slot.tier_requirement && slot.tier_requirement !== "any" && (
                        <p className="mt-1 text-xs text-brand">Tier: {slot.tier_requirement}</p>
                      )}
                    </div>
                    <div>
                      <label htmlFor={`slot-prio-${pi}-${si}`} className="field-label">Priority</label>
                      <select id={`slot-prio-${pi}-${si}`} className="field sm:w-32" value={slot.priority} onChange={(e) => setSlot(pi, si, { priority: e.target.value as SlotPriority })}>
                        <option value="high">High</option>
                        <option value="normal">Normal</option>
                        <option value="low">Low</option>
                      </select>
                    </div>
                    <div>
                      <label htmlFor={`slot-notes-${pi}-${si}`} className="field-label">Notes</label>
                      <input id={`slot-notes-${pi}-${si}`} className="field sm:w-44" value={slot.notes} onChange={(e) => setSlot(pi, si, { notes: e.target.value })} maxLength={200} />
                    </div>
                    <div>
                      <span className="field-label">Required</span>
                      <input
                        type="checkbox"
                        aria-label="Required slot"
                        checked={slot.required}
                        onChange={(e) => setSlot(pi, si, { required: e.target.checked })}
                      />
                    </div>
                    <div className="ml-auto flex items-center gap-1 pb-0.5">
                      {slot.assignedIgn && <Badge status="approved">{slot.assignedIgn}</Badge>}
                      <Button type="button" size="sm" variant="ghost" onClick={() => moveSlot(pi, si, -1)} aria-label="Move slot up" disabled={si === 0}>↑</Button>
                      <Button type="button" size="sm" variant="ghost" onClick={() => moveSlot(pi, si, 1)} aria-label="Move slot down" disabled={si === party.slots.length - 1}>↓</Button>
                      <Button type="button" size="sm" variant="outline-danger" onClick={() => setDeleteSlot({ party: pi, slot: si })}>Delete</Button>
                    </div>
                  </div>
                ))}
              </div>
              <Button type="button" size="sm" variant="secondary" className="mt-2" onClick={() => addSlot(pi)}>+ Add slot</Button>
            </div>
          ))}
          <datalist id="albion-roles">{ALBION_ROLES.map((r) => <option key={r} value={r} />)}</datalist>
          <datalist id="albion-builds">{ALBION_BUILDS.map((b) => <option key={b} value={b} />)}</datalist>
          <p className="field-hint">Type any custom role or build — the lists are suggestions, not limits.</p>
        </div>
      )}

      {/* STEP 4 — team assignment (§28) */}
      {step === 3 && (
        <div className="panel p-4">
          <label htmlFor="ms-team" className="field-label">Assign to team *</label>
          <select id="ms-team" className="field sm:w-72" value={state.team_id} onChange={(e) => set({ team_id: e.target.value })}>
            <option value="">Select a team…</option>
            {teams.map((t) => <option key={t.id} value={t.id}>{t.name}</option>)}
          </select>
          <p className="field-hint mt-2">
            Only this team's members will see the sheet once published — enforced by RLS, not the UI.
          </p>
        </div>
      )}

      {/* STEP 5 — preview (§12) */}
      {step === 4 && (
        <div className="space-y-3">
          <MassSheetPreview
            title={state.title}
            location={state.location}
            setName={state.set_name}
            massAtLabel={massAtLabel}
            parties={state.parties}
          />
          <p className="field-hint">
            {totalSlots} slots across {state.parties.length} parties. Saving as draft keeps it admin-only until you publish.
          </p>
        </div>
      )}

      {/* Footer nav */}
      <div className="flex flex-wrap items-center justify-between gap-2 border-t border-line pt-3">
        <div className="flex gap-2">
          <Button type="button" variant="secondary" size="sm" onClick={() => setStep((s) => Math.max(0, s - 1))} disabled={step === 0}>← Back</Button>
          <Button type="button" variant="secondary" size="sm" onClick={() => setStep((s) => Math.min(STEPS.length - 1, s + 1))} disabled={step === STEPS.length - 1}>Next →</Button>
        </div>
        <div className="flex gap-2">
          <Button type="button" variant="ghost" onClick={onCancel}>Cancel</Button>
          <Button type="button" onClick={() => onSave(state)} disabled={!canSave} loading={busy}>
            {busy ? "Saving…" : saveLabel}
          </Button>
        </div>
      </div>

      {/* Delete confirmations — warn about assignments (§24) */}
      <ConfirmDialog
        open={deleteParty !== null}
        title="Delete party?"
        body={deleteParty !== null
          ? `Delete "${state.parties[deleteParty]?.name ?? ""}" and all its slots? Existing member assignments in those slots will be removed.`
          : ""}
        confirmLabel="Delete party"
        danger
        busy={busy}
        onConfirm={() => deleteParty !== null && removeParty(deleteParty)}
        onCancel={() => setDeleteParty(null)}
      />
      <ConfirmDialog
        open={deleteSlot !== null}
        title="Delete slot?"
        body={(() => {
          if (!deleteSlot) return "";
          const s = state.parties[deleteSlot.party]?.slots[deleteSlot.slot];
          if (!s) return "";
          return s.assignedIgn
            ? `This slot is currently assigned to ${s.assignedIgn}. Deleting it will remove the assignment.`
            : `Delete this slot (${s.build_name || s.role || "unnamed"})?`;
        })()}
        confirmLabel="Delete slot"
        danger
        busy={busy}
        onConfirm={() => deleteSlot && removeSlot(deleteSlot.party, deleteSlot.slot)}
        onCancel={() => setDeleteSlot(null)}
      />

      {/* Albion equipment browser (Phase 4/26) — selection sets build + tier */}
      <Modal open={pickerSlot !== null} onClose={() => setPickerSlot(null)} title="Albion equipment" wide>
        {pickerSlot && (
          <EquipmentPicker
            onPick={(name, tier) => {
              setSlot(pickerSlot.party, pickerSlot.slot, { build_name: name, tier_requirement: tier });
            }}
            onClose={() => setPickerSlot(null)}
          />
        )}
      </Modal>
    </div>
  );
}
