"use client";

/**
 * The spreadsheet-style event sheet: party tables with role / equipment /
 * IGN columns, composable requirement display ("Heavy Mace / Guardian Armor /
 * Shield"), claim + leave with profile-IGN prefill, status badges with text
 * + symbols, search and filters, and mobile party cards.
 */
import { useMemo, useState } from "react";
import { Badge, Button, Modal } from "@/components/ui";
import { friendlyEventError, EventError, requirementLabel, type EventFull, type EventSlot } from "@/lib/events";

export type SlotAction =
  | { kind: "claim"; slot: EventSlot; note?: string }
  | { kind: "leave"; slot: EventSlot }
  | { kind: "adminClear"; slot: EventSlot };

interface Props {
  event: EventFull;
  currentUserId: string | null;
  isAdmin: boolean;
  /** Members interact only on published events; locked/completed are read-only. */
  editable: boolean;
  onAction: (action: SlotAction) => Promise<void> | void;
}

export function EventSheet({ event, currentUserId, isAdmin, editable, onAction }: Props) {
  const [search, setSearch] = useState("");
  const [roleFilter, setRoleFilter] = useState("all");
  const [partyFilter, setPartyFilter] = useState("all");
  const [statusFilter, setStatusFilter] = useState("all");
  const [claimSlot, setClaimSlot] = useState<EventSlot | null>(null);
  const [claimNote, setClaimNote] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const roles = useMemo(
    () => [...new Set(event.event_parties.flatMap((p) => p.event_slots.map((s) => s.role)))].sort(),
    [event],
  );

  const matches = (s: EventSlot, partyId: string) => {
    if (partyFilter !== "all" && partyId !== partyFilter) return false;
    if (roleFilter !== "all" && s.role !== roleFilter) return false;
    if (statusFilter === "open" && s.event_signups.length > 0) return false;
    if (statusFilter === "filled" && s.event_signups.length === 0) return false;
    if (statusFilter === "mine" && !s.event_signups.some((a) => a.user_id === currentUserId)) return false;
    if (search) {
      const hay = `${s.role} ${requirementLabel(s)} ${s.notes ?? ""} ${s.event_signups.map((a) => a.ign).join(" ")}`.toLowerCase();
      if (!hay.includes(search.toLowerCase())) return false;
    }
    return true;
  };

  const filtering = search !== "" || roleFilter !== "all" || partyFilter !== "all" || statusFilter !== "all";

  const confirmClaim = async () => {
    if (!claimSlot || busy) return; // busy guard: no duplicate submissions
    setBusy(true);
    setError(null);
    try {
      await onAction({ kind: "claim", slot: claimSlot, note: claimNote.trim() || undefined });
      setClaimSlot(null);
    } catch (err) {
      setError(friendlyEventError(err instanceof EventError ? err.code : "UNKNOWN"));
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center gap-2">
        <input type="search" className="field sm:w-64" placeholder="Search IGN, equipment, role…" value={search} onChange={(e) => setSearch(e.target.value)} aria-label="Search slots" />
        <select className="field sm:w-40" value={roleFilter} onChange={(e) => setRoleFilter(e.target.value)} aria-label="Filter by role">
          <option value="all">All roles</option>
          {roles.map((r) => <option key={r} value={r}>{r}</option>)}
        </select>
        <select className="field sm:w-44" value={partyFilter} onChange={(e) => setPartyFilter(e.target.value)} aria-label="Filter by party">
          <option value="all">All parties</option>
          {event.event_parties.map((p) => <option key={p.id} value={p.id}>{p.name}</option>)}
        </select>
        <select className="field sm:w-40" value={statusFilter} onChange={(e) => setStatusFilter(e.target.value)} aria-label="Filter by status">
          <option value="all">All slots</option>
          <option value="open">Open only</option>
          <option value="filled">Filled only</option>
          {currentUserId && <option value="mine">My slots</option>}
        </select>
      </div>

      <div className="grid gap-4 lg:grid-cols-2 2xl:grid-cols-3">
        {event.event_parties.map((party) => {
          const visible = party.event_slots.filter((s) => matches(s, party.id));
          if (visible.length === 0 && filtering) return null;
          return (
            <section key={party.id} className="panel overflow-hidden p-0">
              <header className="border-b border-line-strong px-3 py-2">
                <h3 className="section-title">{party.name}</h3>
                {party.fill_note && <p className="mt-0.5 flex items-center gap-1 text-xs text-warn">★ {party.fill_note}</p>}
              </header>

              <table className="hidden w-full text-sm sm:table">
                <thead>
                  <tr className="text-left text-xs uppercase tracking-wide text-faint">
                    <th className="px-3 py-2 font-semibold">Role</th>
                    <th className="px-3 py-2 font-semibold">Equipment</th>
                    <th className="px-3 py-2 font-semibold">IGN</th>
                    <th className="px-3 py-2 font-semibold">Status</th>
                    <th className="px-3 py-2" aria-label="Actions" />
                  </tr>
                </thead>
                <tbody>
                  {visible.map((slot, i) => (
                    <SlotRow key={slot.id} slot={slot} zebra={i % 2 === 1} currentUserId={currentUserId} isAdmin={isAdmin} editable={editable} onAction={onAction} onClaim={(s) => { setError(null); setClaimNote(""); setClaimSlot(s); }} />
                  ))}
                </tbody>
              </table>

              <div className="divide-y divide-line sm:hidden">
                {visible.map((slot) => (
                  <SlotCard key={slot.id} slot={slot} currentUserId={currentUserId} isAdmin={isAdmin} editable={editable} onAction={onAction} onClaim={(s) => { setError(null); setClaimNote(""); setClaimSlot(s); }} />
                ))}
              </div>
            </section>
          );
        })}
      </div>

      {/* Claim modal — IGN comes from the profile server-side */}
      <Modal open={Boolean(claimSlot)} onClose={() => setClaimSlot(null)} title="Claim slot">
        {claimSlot && (
          <form onSubmit={(e) => { e.preventDefault(); void confirmClaim(); }} className="space-y-3">
            <p className="text-sm text-muted">
              {claimSlot.role} · <span className="font-mono text-[13px]">{requirementLabel(claimSlot)}</span>
              {claimSlot.priority === "high" && " · ★ High priority"}
            </p>
            {claimSlot.notes && <p className="rounded-md bg-elevated/60 p-2 text-xs text-muted">⚠ {claimSlot.notes}</p>}
            <div>
              <label htmlFor="claim-note" className="field-label">Note (optional)</label>
              <input id="claim-note" className="field" value={claimNote} onChange={(e) => setClaimNote(e.target.value)} maxLength={200} placeholder="e.g. alt character, slightly under-tier" />
            </div>
            {error && <p className="text-sm text-danger" role="alert">{error}</p>}
            <div className="flex justify-end gap-2 pt-1">
              <Button type="button" variant="secondary" onClick={() => setClaimSlot(null)}>Cancel</Button>
              <Button type="submit" loading={busy}>{busy ? "Claiming…" : "Confirm"}</Button>
            </div>
          </form>
        )}
      </Modal>
    </div>
  );
}

function StatusBadge({ slot }: { slot: EventSlot }) {
  const signup = slot.event_signups[0];
  if (signup) return <Badge status="approved">● {signup.ign}</Badge>;
  if (slot.priority === "high") return <Badge status="pending">★ Available</Badge>;
  return <Badge status="open">○ Available</Badge>;
}

function Actions({ slot, currentUserId, isAdmin, editable, onAction, onClaim }: {
  slot: EventSlot;
  currentUserId: string | null;
  isAdmin: boolean;
  editable: boolean;
  onAction: (action: SlotAction) => Promise<void> | void;
  onClaim: (slot: EventSlot) => void;
}) {
  const signup = slot.event_signups[0];
  const mine = signup && signup.user_id === currentUserId;
  if (isAdmin && signup) {
    return <Button size="sm" variant="ghost" onClick={() => void onAction({ kind: "adminClear", slot })}>Remove</Button>;
  }
  if (!editable) return null;
  if (mine) return <Button size="sm" variant="secondary" onClick={() => void onAction({ kind: "leave", slot })}>Leave</Button>;
  if (signup) return null;
  return <Button size="sm" onClick={() => onClaim(slot)}>Claim slot</Button>;
}

function SlotRow({ slot, zebra, currentUserId, isAdmin, editable, onAction, onClaim }: {
  slot: EventSlot; zebra: boolean; currentUserId: string | null; isAdmin: boolean;
  editable: boolean; onAction: (action: SlotAction) => Promise<void> | void; onClaim: (slot: EventSlot) => void;
}) {
  const signup = slot.event_signups[0];
  return (
    <tr className={zebra ? "bg-elevated/40" : undefined}>
      <td className="px-3 py-2 align-top">
        <div className="font-medium text-ink">{slot.role}</div>
        {slot.priority === "high" && <div className="text-xs text-warn">★ High priority</div>}
        {slot.notes && <div className="text-xs text-faint">{slot.notes}</div>}
      </td>
      <td className="px-3 py-2 align-top font-mono text-xs">
        {requirementLabel(slot)}
      </td>
      <td className="px-3 py-2 align-top font-semibold">{signup ? signup.ign : <span className="text-faint">—</span>}</td>
      <td className="px-3 py-2 align-top"><StatusBadge slot={slot} /></td>
      <td className="px-3 py-2 align-top text-right">
        <Actions slot={slot} currentUserId={currentUserId} isAdmin={isAdmin} editable={editable} onAction={onAction} onClaim={onClaim} />
      </td>
    </tr>
  );
}

function SlotCard({ slot, currentUserId, isAdmin, editable, onAction, onClaim }: {
  slot: EventSlot; currentUserId: string | null; isAdmin: boolean;
  editable: boolean; onAction: (action: SlotAction) => Promise<void> | void; onClaim: (slot: EventSlot) => void;
}) {
  const signup = slot.event_signups[0];
  return (
    <div className="px-3 py-3">
      <div className="flex items-center justify-between gap-2">
        <div>
          <div className="text-sm font-medium text-ink">{slot.role} · <span className="font-mono text-xs">{requirementLabel(slot)}</span></div>
          <div className="text-sm font-semibold">{signup ? signup.ign : <span className="text-faint">Available</span>}</div>
        </div>
        <StatusBadge slot={slot} />
      </div>
      <div className="mt-2">
        <Actions slot={slot} currentUserId={currentUserId} isAdmin={isAdmin} editable={editable} onAction={onAction} onClaim={onClaim} />
      </div>
    </div>
  );
}
