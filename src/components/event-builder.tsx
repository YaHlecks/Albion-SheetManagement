"use client";

/**
 * Admin Event Builder: basic information → party builder → slot builder with
 * COMPOSABLE equipment requirements (each row: any number of requirements,
 * e.g. Tank = Weapon+Head+Chest+Feet+Off-Hand, Battlemount = Mount+Weapon,
 * DPS = weapon only) → preview → save as draft/template. Edits happen on a
 * local draft; saving is one atomic RPC.
 */
import { useMemo, useState } from "react";
import { Badge, Button, ConfirmDialog, Modal } from "@/components/ui";
import { EquipmentPicker } from "@/components/equipment-picker";
import {
  FILL_NOTES, REQ_CATEGORIES, ROLES, TIMEZONES, TIER_OPTIONS,
  validateForPublish, type EventDraft, type SlotPriority,
} from "@/lib/events";

const STEPS = ["Information", "Parties", "Slots & equipment", "Preview"] as const;

type SlotDraft = EventDraft["parties"][number]["slots"][number];

interface Props {
  draft: EventDraft;
  onChange: (next: EventDraft) => void;
  busy: boolean;
  onSave: (draft: EventDraft, thenPublish: boolean) => void;
  onCancel: () => void;
  saveLabel?: string;
}

export function EventBuilder({ draft, onChange, busy, onSave, onCancel, saveLabel = "Save draft" }: Props) {
  const [step, setStep] = useState(0);
  const [deleteParty, setDeleteParty] = useState<number | null>(null);
  const [deleteSlot, setDeleteSlot] = useState<{ party: number; slot: number } | null>(null);
  const [picker, setPicker] = useState<{ party: number; slot: number; req: number } | null>(null);
  const [showCustomRole, setShowCustomRole] = useState<Record<string, boolean>>({});

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
      slots: src.slots.map((s) => ({
        ...s, id: undefined, assignedIgn: null,
        requirements: s.requirements.map((r) => ({ ...r, id: undefined })),
      })),
    };
    const parties = [...draft.parties];
    parties.splice(i + 1, 0, copy);
    set({ parties });
  };

  const removeParty = (i: number) => {
    set({ parties: draft.parties.filter((_, idx) => idx !== i) });
    setDeleteParty(null);
  };

  const moveParty = (i: number, dir: -1 | 1) => {
    const parties = [...draft.parties];
    const j = i + dir;
    if (j < 0 || j >= parties.length) return;
    [parties[i], parties[j]] = [parties[j], parties[i]];
    set({ parties });
  };

  const addSlot = (pi: number, role = "DPS") =>
    setParty(pi, {
      slots: [...draft.parties[pi].slots, {
        role, notes: "", priority: "normal", required: true, requirements: [],
      }],
    });

  const setSlot = (pi: number, si: number, patch: Partial<SlotDraft>) => {
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

  const addRequirement = (pi: number, si: number, category = "Weapon") => {
    const slot = draft.parties[pi].slots[si];
    setSlot(pi, si, {
      requirements: [...slot.requirements, { category, item: "", tier_requirement: "any" }],
    });
  };

  const setRequirement = (pi: number, si: number, ri: number, patch: Partial<SlotDraft["requirements"][number]>) => {
    const slot = draft.parties[pi].slots[si];
    setSlot(pi, si, {
      requirements: slot.requirements.map((r, idx) => (idx === ri ? { ...r, ...patch } : r)),
    });
  };

  const removeRequirement = (pi: number, si: number, ri: number) => {
    const slot = draft.parties[pi].slots[si];
    setSlot(pi, si, { requirements: slot.requirements.filter((_, idx) => idx !== ri) });
  };

  const moveRequirement = (pi: number, si: number, ri: number, dir: -1 | 1) => {
    const reqs = [...draft.parties[pi].slots[si].requirements];
    const j = ri + dir;
    if (j < 0 || j >= reqs.length) return;
    [reqs[ri], reqs[j]] = [reqs[j], reqs[ri]];
    setSlot(pi, si, { requirements: reqs });
  };

  const totalSlots = draft.parties.reduce((n, p) => n + p.slots.length, 0);
  const canSave = draft.title.trim().length >= 2;
  const publishProblems = useMemo(() => validateForPublish(draft), [draft]);
  const canPublish = canSave && publishProblems.length === 0;

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

      {/* STEP 1 — information */}
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

      {/* STEP 2 — party builder */}
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
                  <Button type="button" size="sm" variant="ghost" onClick={() => moveParty(pi, -1)} disabled={pi === 0} aria-label="Move party up">↑</Button>
                  <Button type="button" size="sm" variant="ghost" onClick={() => moveParty(pi, 1)} disabled={pi === draft.parties.length - 1} aria-label="Move party down">↓</Button>
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

      {/* STEP 3 — slot builder with composable requirements */}
      {step === 2 && (
        <div className="space-y-3">
          {draft.parties.map((party, pi) => (
            <div key={pi} className="panel p-3">
              <h3 className="section-title mb-2">{party.name}{party.fill_note ? ` — ${party.fill_note}` : ""}</h3>
              <div className="space-y-2">
                {party.slots.map((slot, si) => (
                  <div key={si} className="rounded-lg bg-elevated/60 p-2">
                    <div className="flex flex-wrap items-end gap-2">
                      <div>
                        <label htmlFor={`slot-role-${pi}-${si}`} className="field-label">Role</label>
                        {showCustomRole[`${pi}-${si}`] ? (
                          <input
                            id={`slot-role-${pi}-${si}`}
                            className="field sm:w-36"
                            value={slot.role}
                            onChange={(e) => setSlot(pi, si, { role: e.target.value })}
                            maxLength={40}
                            autoFocus
                          />
                        ) : (
                          <select
                            id={`slot-role-${pi}-${si}`}
                            className="field sm:w-36"
                            value={ROLES.includes(slot.role as (typeof ROLES)[number]) ? slot.role : "__custom"}
                            onChange={(e) => {
                              if (e.target.value === "__custom") {
                                setShowCustomRole((m) => ({ ...m, [`${pi}-${si}`]: true }));
                                setSlot(pi, si, { role: "" });
                              } else {
                                setSlot(pi, si, { role: e.target.value });
                              }
                            }}
                          >
                            {ROLES.map((r) => <option key={r} value={r}>{r}</option>)}
                            {ROLES.includes(slot.role as (typeof ROLES)[number]) ? null : <option value={slot.role}>{slot.role}</option>}
                            <option value="__custom">Custom…</option>
                          </select>
                        )}
                      </div>
                      <div>
                        <label htmlFor={`slot-prio-${pi}-${si}`} className="field-label">Priority</label>
                        <select id={`slot-prio-${pi}-${si}`} className="field sm:w-28" value={slot.priority} onChange={(e) => setSlot(pi, si, { priority: e.target.value as SlotPriority })}>
                          <option value="high">High</option>
                          <option value="normal">Normal</option>
                          <option value="low">Low</option>
                        </select>
                      </div>
                      <div className="min-w-52 flex-1">
                        <label htmlFor={`slot-notes-${pi}-${si}`} className="field-label">Special instructions</label>
                        <input id={`slot-notes-${pi}-${si}`} className="field" value={slot.notes} onChange={(e) => setSlot(pi, si, { notes: e.target.value })} placeholder="e.g. USE 1H MACE · BRING POISON · FILL P1 FIRST" maxLength={200} />
                      </div>
                      <div className="ml-auto flex items-center gap-1 pb-0.5">
                        {slot.assignedIgn && <Badge status="approved">{slot.assignedIgn}</Badge>}
                        <Button type="button" size="sm" variant="ghost" onClick={() => moveSlot(pi, si, -1)} aria-label="Move slot up" disabled={si === 0}>↑</Button>
                        <Button type="button" size="sm" variant="ghost" onClick={() => moveSlot(pi, si, 1)} aria-label="Move slot down" disabled={si === party.slots.length - 1}>↓</Button>
                        <Button type="button" size="sm" variant="outline-danger" onClick={() => setDeleteSlot({ party: pi, slot: si })}>Delete</Button>
                      </div>
                    </div>

                    {/* Composable requirements — the spreadsheet row's gear */}
                    <div className="mt-2 space-y-1.5">
                      <p className="field-label">Required equipment ({slot.requirements.length})</p>
                      {slot.requirements.map((req, ri) => (
                        <div key={ri} className="flex flex-wrap items-center gap-1.5 rounded-md bg-surface p-1.5">
                          <select
                            className="field h-9 w-28 text-xs"
                            value={req.category}
                            onChange={(e) => setRequirement(pi, si, ri, { category: e.target.value })}
                            aria-label="Requirement category"
                          >
                            {REQ_CATEGORIES.map((c) => <option key={c} value={c}>{c}</option>)}
                          </select>
                          <input
                            className="field h-9 min-w-0 flex-1 font-mono text-xs"
                            value={req.item}
                            onChange={(e) => setRequirement(pi, si, ri, { item: e.target.value })}
                            placeholder="Item name — type or Browse"
                            maxLength={120}
                            aria-label="Requirement item"
                          />
                          <select
                            className="field h-9 w-24 text-xs"
                            value={req.tier_requirement}
                            onChange={(e) => setRequirement(pi, si, ri, { tier_requirement: e.target.value })}
                            aria-label="Requirement tier"
                          >
                            {TIER_OPTIONS.map((t) => <option key={t} value={t}>{t === "any" ? "Any" : t}</option>)}
                          </select>
                          <Button type="button" size="sm" variant="secondary" className="h-9" onClick={() => setPicker({ party: pi, slot: si, req: ri })}>Browse</Button>
                          <Button type="button" size="sm" variant="ghost" onClick={() => moveRequirement(pi, si, ri, -1)} disabled={ri === 0} aria-label="Move requirement up">↑</Button>
                          <Button type="button" size="sm" variant="ghost" onClick={() => moveRequirement(pi, si, ri, 1)} disabled={ri === slot.requirements.length - 1} aria-label="Move requirement down">↓</Button>
                          <Button type="button" size="sm" variant="outline-danger" onClick={() => removeRequirement(pi, si, ri)} aria-label="Remove requirement">✕</Button>
                        </div>
                      ))}
                      <div className="flex flex-wrap gap-1.5">
                        <Button type="button" size="sm" variant="secondary" onClick={() => addRequirement(pi, si, "Weapon")}>+ Weapon</Button>
                        <Button type="button" size="sm" variant="secondary" onClick={() => addRequirement(pi, si, "Head")}>+ Head</Button>
                        <Button type="button" size="sm" variant="secondary" onClick={() => addRequirement(pi, si, "Chest")}>+ Chest</Button>
                        <Button type="button" size="sm" variant="secondary" onClick={() => addRequirement(pi, si, "Feet")}>+ Feet</Button>
                        <Button type="button" size="sm" variant="secondary" onClick={() => addRequirement(pi, si, "Off-Hand")}>+ Off-Hand</Button>
                        <Button type="button" size="sm" variant="secondary" onClick={() => addRequirement(pi, si, "Mount")}>+ Mount</Button>
                        <Button type="button" size="sm" variant="ghost" onClick={() => addRequirement(pi, si, "Cape")}>+ Cape</Button>
                        <Button type="button" size="sm" variant="ghost" onClick={() => addRequirement(pi, si, "Bag")}>+ Bag</Button>
                        <Button type="button" size="sm" variant="ghost" onClick={() => addRequirement(pi, si, "Other")}>+ Other</Button>
                      </div>
                    </div>
                  </div>
                ))}
              </div>
              <div className="mt-2 flex flex-wrap gap-1.5">
                <Button type="button" size="sm" variant="secondary" onClick={() => addSlot(pi, "DPS")}>+ DPS</Button>
                <Button type="button" size="sm" variant="secondary" onClick={() => addSlot(pi, "Tank")}>+ Tank</Button>
                <Button type="button" size="sm" variant="secondary" onClick={() => addSlot(pi, "Healer")}>+ Healer</Button>
                <Button type="button" size="sm" variant="secondary" onClick={() => addSlot(pi, "Support")}>+ Support</Button>
                <Button type="button" size="sm" variant="secondary" onClick={() => addSlot(pi, "Caller")}>+ Caller</Button>
                <Button type="button" size="sm" variant="secondary" onClick={() => addSlot(pi, "Battlemount")}>+ Battlemount</Button>
                <Button type="button" size="sm" variant="ghost" onClick={() => addSlot(pi, "Fill")}>+ Fill</Button>
              </div>
            </div>
          ))}
          <p className="field-hint">
            Roles are spreadsheet labels — pick a preset or Custom. A row can need any
            combination of gear: weapon-only DPS, full tank sets, Mount + Weapon battlemounts.
          </p>
        </div>
      )}

      {/* STEP 4 — preview (the real sheet layout) */}
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
                          <td className="py-0.5 pr-2 font-medium">{slot.role || "Fill"}</td>
                          <td className="py-0.5 pr-2 font-mono">
                            {slot.requirements.filter((r) => r.item.trim()).length === 0
                              ? "—"
                              : slot.requirements.filter((r) => r.item.trim()).map((r) => r.item + (r.tier_requirement !== "any" ? ` (${r.tier_requirement})` : "")).join(" / ")}
                          </td>
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

      {/* Footer — Save from ANY step (minimal draft validation); Publish only
          when the strict publish gate passes. Failures keep the form intact. */}
      <div className="space-y-2 border-t border-line pt-3">
        {step === 3 && publishProblems.length > 0 && (
          <div className="panel border-amber-500/40 bg-amber-500/10 p-3 text-sm text-ink">
            <p className="font-semibold">Before publishing you need:</p>
            <ul className="mt-1 list-inside list-disc text-xs text-muted">
              {publishProblems.map((p) => <li key={p}>{p}</li>)}
            </ul>
            <p className="mt-1 text-xs text-faint">You can still save this as a draft and finish it later.</p>
          </div>
        )}
        <div className="flex flex-wrap items-center justify-between gap-2">
          <div className="flex gap-2">
            <Button type="button" variant="secondary" size="sm" onClick={() => setStep((s) => Math.max(0, s - 1))} disabled={step === 0}>← Back</Button>
            <Button type="button" variant="secondary" size="sm" onClick={() => setStep((s) => Math.min(STEPS.length - 1, s + 1))} disabled={step === STEPS.length - 1}>Next →</Button>
          </div>
          <div className="flex flex-wrap gap-2">
            <Button type="button" variant="ghost" onClick={onCancel}>Cancel</Button>
            <Button type="button" onClick={() => onSave(draft, false)} disabled={!canSave} loading={busy}>
              {busy ? "Saving…" : saveLabel}
            </Button>
            {canPublish && (
              <Button type="button" variant="primary" onClick={() => onSave(draft, true)} loading={busy}>
                Publish event
              </Button>
            )}
          </div>
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
            : `Delete this slot (${s.role || "unnamed"})?`;
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
            onPick={(category, name, tier) => setRequirement(picker.party, picker.slot, picker.req, { category, item: name, tier_requirement: tier })}
            onClose={() => setPicker(null)}
          />
        )}
      </Modal>
    </div>
  );
}
