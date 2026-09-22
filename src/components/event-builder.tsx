"use client";

/**
 * Admin Event Builder (§13): basic information → party builder → slot
 * builder (with the Albion equipment browser) → preview → save as draft /
 * template. Edits happen on a local draft; saving is one atomic RPC.
 */
import { useMemo, useState } from "react";
import { Badge, Button, ConfirmDialog, Modal } from "@/components/ui";
import { EquipmentPicker } from "@/components/equipment-picker";
import {
  FILL_NOTES, ROLES, TIMEZONES, TIER_OPTIONS,
  type EventDraft, type SlotPriority,
} from "@/lib/events";

const STEPS = ["Information", "Parties", "Slots & equipment", "Preview"] as const;

interface Props {
  draft: EventDraft;
  onChange: (next: EventDraft) => void;
  busy: boolean;
  onSave: (draft: EventDraft) => void;
  onCancel: () => void;
  saveLabel?: string;
}

export function EventBuilder({ draft, onChange, busy, onSave, onCancel, saveLabel = "Save draft" }: Props) {
  const [step, setStep] = useState(0);
  const [deleteParty, setDeleteParty] = useState<number | null>(null);
  const [deleteSlot, setDeleteSlot] = useState<{ party: number; slot: number } | null>(null);
  const [picker, setPicker] = useState<{ party: number; slot: number } | null>(null);

  const set = (patch: Partial<EventDraft>) => onChange({ ...draft, ...patch });

  const setParty = (i: number, patch: Partial<EventDraft["parties"][number]>) =>
    set({ parties: draft.parties.map((p, idx) => (idx === i ? { ...p, ...patch } : p)) });

  const addParty = () => {
    if (draft.parties.length >= 12) return;
    set({ parties: [...draft.parties, { name: `Party ${draft.parties.length + 1}`, fill_note: "", slots: [] }] });
  };

  const duplicateParty = (i: number) => {
    if (draft.parties.length >= 12) return;
    const src = draft.parties[i];
    const copy = {
      name: `${src.name} (copy)`,
      fill_note: src.fill_note,
      slots: src.slots.map((s) => ({ ...s, id: undefined, assignedIgn: null })),
    };
    const parties = [...draft.parties];
    parties.splice(i + 1, 0, copy);
    set({ parties });
  };

  const removeParty = (i: number) => {
    set({ parties: draft.parties.filter((_, idx) => idx !== i) });
    setDeleteParty(null);
  };

  const addSlot = (pi: number) =>
    setParty(pi, {
      slots: [...draft.parties[pi].slots, {
        role: "DPS", equipment: "", tier_requirement: "any",
        notes: "", priority: "normal", required: true,
      }],
    });

  const setSlot = (pi: number, si: number, patch: Partial<EventDraft["parties"][number]["slots"][number]>) => {
    const party = draft.parties[pi];
    setParty(pi, { slots: party.slots.map((s, idx) => (idx === si ? { ...s, ...patch } : s)) });
  };

  const removeSlot = (pi: number, si: number) => {
    setParty(pi, { slots: draft.parties[pi].slots.filter((_, idx) => idx !== si) });
    setDeleteSlot(null);
  };

  const moveSlot = (pi: number, si: number, dir: -1 | 1) => {
    const slots = [...draft.parties[pi].slots];
    const j = si + dir;
    if (j < 0 || j >= slots.length) return;
    [slots[si], slots[j]] = [slots[j], slots[si]];
    setParty(pi, { slots });
  };

  const totalSlots = draft.parties.reduce((n, p) => n + p.slots.length, 0);
  const canSave = draft.title.trim().length >= 2 && totalSlots > 0;

  const whenLabel = useMemo(() => {
    if (!draft.event_date && !draft.massing_time) return "";
    return [draft.event_date, draft.massing_time && `${draft.massing_time} ${draft.timezone}`].filter(Boolean).join(" · ");
  }, [draft.event_date, draft.massing_time, draft.timezone]);

  return (
    <div className="space-y-4">
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

      {/* STEP 1 — information (§13 basic + mass information) */}
      {step === 0 && (
        <div className="panel grid gap-3 p-4 sm:grid-cols-2">
          <div className="sm:col-span-2">
            <label htmlFor="ev-title" className="field-label">Event name *</label>
            <input id="ev-title" className="field" value={draft.title} onChange={(e) => set({ title: e.target.value })} placeholder="Martlock Portal 1+1" maxLength={120} />
          </div>
          <div>
            <label htmlFor="ev-date" className="field-label">Event date</label>
            <input id="ev-date" type="date" className="field" value={draft.event_date} onChange={(e) => set({ event_date: e.target.value })} />
          </div>
          <div>
            <label htmlFor="ev-time" className="field-label">Massing time</label>
            <input id="ev-time" type="time" className="field" value={draft.massing_time} onChange={(e) => set({ massing_time: e.target.value })} />
          </div>
          <div>
            <label htmlFor="ev-tz" className="field-label">Timezone</label>
            <select id="ev-tz" className="field" value={draft.timezone} onChange={(e) => set({ timezone: e.target.value })}>
              {TIMEZONES.map((tz) => <option key={tz} value={tz}>{tz}</option>)}
            </select>
          </div>
          <div>
            <label htmlFor="ev-caller" className="field-label">Caller</label>
            <input id="ev-caller" className="field" value={draft.caller} onChange={(e) => set({ caller: e.target.value })} maxLength={60} />
          </div>
          <div>
            <label htmlFor="ev-location" className="field-label">Location</label>
            <input id="ev-location" className="field" value={draft.location} onChange={(e) => set({ location: e.target.value })} placeholder="MARTLOCK PORTAL" maxLength={120} />
          </div>
          <div>
            <label htmlFor="ev-portal" className="field-label">Portal</label>
            <input id="ev-portal" className="field" value={draft.portal} onChange={(e) => set({ portal: e.target.value })} maxLength={120} />
          </div>
          <div>
            <label htmlFor="ev-set" className="field-label">Set</label>
            <input id="ev-set" className="field" value={draft.set_name} onChange={(e) => set({ set_name: e.target.value })} placeholder="1+1" maxLength={60} />
          </div>
          <div className="sm:col-span-2">
            <label htmlFor="ev-desc" className="field-label">Description</label>
            <textarea id="ev-desc" className="field" rows={2} value={draft.description} onChange={(e) => set({ description: e.target.value })} maxLength={2000} />
          </div>
          <div className="sm:col-span-2">
            <label htmlFor="ev-instr" className="field-label">Instructions (shown to members)</label>
            <textarea id="ev-instr" className="field" rows={3} value={draft.instructions} onChange={(e) => set({ instructions: e.target.value })} placeholder="Fill Party 1 first before Party 2…" maxLength={2000} />
          </div>
        </div>
      )}

      {/* STEP 2 — party builder (§8) */}
      {step === 1 && (
        <div className="space-y-3">
          {draft.parties.map((party, pi) => (
            <div key={pi} className="panel p-3">
              <div className="flex flex-wrap items-center gap-2">
                <input className="field sm:w-56" value={party.name} onChange={(e) => setParty(pi, { name: e.target.value })} aria-label={`Party ${pi + 1} name`} maxLength={80} />
                <select className="field sm:w-60" value={party.fill_note} onChange={(e) => setParty(pi, { fill_note: e.target.value })} aria-label="Fill note">
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
          <Button type="button" variant="secondary" onClick={addParty} disabled={draft.parties.length >= 12}>+ Add party</Button>
        </div>
      )}

      {/* STEP 3 — slot builder (§9) */}
      {step === 2 && (
        <div className="space-y-3">
          {draft.parties.map((party, pi) => (
            <div key={pi} className="panel p-3">
              <h3 className="section-title mb-2">{party.name}{party.fill_note ? ` — ${party.fill_note}` : ""}</h3>
              <div className="space-y-2">
                {party.slots.map((slot, si) => (
                  <div key={si} className="flex flex-wrap items-end gap-2 rounded-lg bg-elevated/60 p-2">
                    <div>
                      <label htmlFor={`slot-role-${pi}-${si}`} className="field-label">Role</label>
                      <input id={`slot-role-${pi}-${si}`} list="event-roles" className="field sm:w-32" value={slot.role} onChange={(e) => setSlot(pi, si, { role: e.target.value })} maxLength={40} />
                    </div>
                    <div>
                      <label htmlFor={`slot-eq-${pi}-${si}`} className="field-label">Required equipment</label>
                      <div className="flex gap-1">
                        <input id={`slot-eq-${pi}-${si}`} list="event-equipment" className="field sm:w-44" value={slot.equipment} onChange={(e) => setSlot(pi, si, { equipment: e.target.value })} maxLength={120} />
                        <Button type="button" size="sm" variant="secondary" className="h-10" onClick={() => setPicker({ party: pi, slot: si })}>Browse</Button>
                      </div>
                    </div>
                    <div>
                      <label htmlFor={`slot-tier-${pi}-${si}`} className="field-label">Tier</label>
                      <select id={`slot-tier-${pi}-${si}`} className="field sm:w-24" value={slot.tier_requirement} onChange={(e) => setSlot(pi, si, { tier_requirement: e.target.value })}>
                        {TIER_OPTIONS.map((t) => <option key={t} value={t}>{t === "any" ? "Any" : t}</option>)}
                      </select>
                    </div>
                    <div>
                      <label htmlFor={`slot-prio-${pi}-${si}`} className="field-label">Priority</label>
                      <select id={`slot-prio-${pi}-${si}`} className="field sm:w-28" value={slot.priority} onChange={(e) => setSlot(pi, si, { priority: e.target.value as SlotPriority })}>
                        <option value="high">High</option>
                        <option value="normal">Normal</option>
                        <option value="low">Low</option>
                      </select>
                    </div>
                    <div>
                      <label htmlFor={`slot-notes-${pi}-${si}`} className="field-label">Notes</label>
                      <input id={`slot-notes-${pi}-${si}`} className="field sm:w-44" value={slot.notes} onChange={(e) => setSlot(pi, si, { notes: e.target.value })} maxLength={200} />
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
          <datalist id="event-roles">{ROLES.map((r) => <option key={r} value={r} />)}</datalist>
          <p className="field-hint">Roles and equipment are suggestions — use the Browse picker for the real catalog, or type group shorthand (e.g. “SOB / ICICLE”, “Any DPS”).</p>
        </div>
      )}

      {/* STEP 4 — preview (§8/§14) */}
      {step === 3 && (
        <div className="space-y-3">
          <div className="panel p-0">
            <div className="border-b border-line-strong px-3 py-2">
              <div className="font-display font-semibold text-ink">{draft.title || "Untitled event"}</div>
              <div className="text-xs text-faint">
                {[draft.location && `MASS LOCATION: ${draft.location}`, draft.set_name && `SET: ${draft.set_name}`, whenLabel && `MASSING TIME: ${whenLabel}`, draft.caller && `CALLER: ${draft.caller}`].filter(Boolean).join(" · ")}
              </div>
            </div>
            <div className="grid gap-px bg-line md:grid-cols-2 xl:grid-cols-3">
              {draft.parties.map((party, pi) => (
                <div key={pi} className="p-3">
                  <div className="mb-2 flex items-center justify-between gap-2">
                    <span className="section-title">{party.name || `Party ${pi + 1}`}</span>
                    {party.fill_note && <Badge status="pending">★ {party.fill_note}</Badge>}
                  </div>
                  <table className="w-full text-xs">
                    <thead>
                      <tr className="text-left text-faint">
                        <th className="pb-1 font-semibold">Role</th>
                        <th className="pb-1 font-semibold">Equipment</th>
                        <th className="pb-1 font-semibold">IGN</th>
                      </tr>
                    </thead>
                    <tbody>
                      {party.slots.map((slot, si) => (
                        <tr key={si} className={si % 2 === 1 ? "bg-elevated/40" : undefined}>
                          <td className="py-0.5 pr-2 font-medium">{slot.role}</td>
                          <td className="py-0.5 pr-2 font-mono">{slot.equipment}{slot.tier_requirement !== "any" ? ` (${slot.tier_requirement})` : ""}</td>
                          <td className="py-0.5 text-faint">{slot.assignedIgn ?? "AVAILABLE"}</td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              ))}
            </div>
          </div>
          <p className="field-hint">{totalSlots} slots across {draft.parties.length} parties. Saving as draft keeps it admin-only until you publish.</p>
        </div>
      )}

      {/* Footer */}
      <div className="flex flex-wrap items-center justify-between gap-2 border-t border-line pt-3">
        <div className="flex gap-2">
          <Button type="button" variant="secondary" size="sm" onClick={() => setStep((s) => Math.max(0, s - 1))} disabled={step === 0}>← Back</Button>
          <Button type="button" variant="secondary" size="sm" onClick={() => setStep((s) => Math.min(STEPS.length - 1, s + 1))} disabled={step === STEPS.length - 1}>Next →</Button>
        </div>
        <div className="flex gap-2">
          <Button type="button" variant="ghost" onClick={onCancel}>Cancel</Button>
          <Button type="button" onClick={() => onSave(draft)} disabled={!canSave} loading={busy}>
            {busy ? "Saving…" : saveLabel}
          </Button>
        </div>
      </div>

      <ConfirmDialog
        open={deleteParty !== null}
        title="Delete party?"
        body={deleteParty !== null ? `Delete "${draft.parties[deleteParty]?.name ?? ""}" and all its slots? Member signups in those slots will be removed.` : ""}
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
          const s = draft.parties[deleteSlot.party]?.slots[deleteSlot.slot];
          if (!s) return "";
          return s.assignedIgn
            ? `This slot is signed by ${s.assignedIgn}. Deleting it removes their signup.`
            : `Delete this slot (${s.equipment || s.role || "unnamed"})?`;
        })()}
        confirmLabel="Delete slot"
        danger
        busy={busy}
        onConfirm={() => deleteSlot && removeSlot(deleteSlot.party, deleteSlot.slot)}
        onCancel={() => setDeleteSlot(null)}
      />

      <Modal open={picker !== null} onClose={() => setPicker(null)} title="Albion equipment" wide>
        {picker && (
          <EquipmentPicker
            onPick={(name, tier) => setSlot(picker.party, picker.slot, { equipment: name, tier_requirement: tier })}
            onClose={() => setPicker(null)}
          />
        )}
      </Modal>
    </div>
  );
}
