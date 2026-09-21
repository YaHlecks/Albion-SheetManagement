"use client";

/**
 * The Albion mass sheet view — a spreadsheet-like grid of parties and slots.
 *
 * Desktop: spreadsheet-style party tables. Mobile: party cards (§22).
 * Used by both members (claim/unclaim) and admins (clear overrides).
 * Built strictly on the existing design system (.panel/.field/.badge classes).
 */
import { useMemo, useState } from "react";
import { Badge, Button, Modal } from "@/components/ui";
import type { MassSheetFull, MassSlot, SlotPriority } from "@/lib/mass";
import { friendlyClaimError, MassSheetError } from "@/lib/mass";

const PRIORITY_LABEL: Record<SlotPriority, string> = {
  high: "High",
  normal: "Normal",
  low: "Low",
};

export type SlotAction =
  | { kind: "claim"; slot: MassSlot }
  | { kind: "unclaim"; slot: MassSlot }
  | { kind: "clear"; slot: MassSlot };

interface Props {
  sheet: MassSheetFull;
  currentUserId: string | null;
  isAdmin: boolean;
  /** Members may claim/unclaim only when the sheet is published (RPC re-checks). */
  editable: boolean;
  onAction: (action: SlotAction) => Promise<void> | void;
  /** Prefill for the claim modal from the member's profile (§14). */
  defaultIgn?: string | null;
}

export function MassSheetView({ sheet, currentUserId, isAdmin, editable, onAction, defaultIgn }: Props) {
  const [search, setSearch] = useState("");
  const [roleFilter, setRoleFilter] = useState("all");
  const [partyFilter, setPartyFilter] = useState("all");
  const [statusFilter, setStatusFilter] = useState("all");
  const [claimSlot, setClaimSlot] = useState<MassSlot | null>(null);
  const [claimIgn, setClaimIgn] = useState("");
  const [claimBusy, setClaimBusy] = useState(false);
  const [claimError, setClaimError] = useState<string | null>(null);

  const roles = useMemo(
    () => [...new Set(sheet.mass_parties.flatMap((p) => p.mass_slots.map((s) => s.role)))].sort(),
    [sheet],
  );

  const matches = (s: MassSlot, partyId: string) => {
    if (partyFilter !== "all" && partyId !== partyFilter) return false;
    if (roleFilter !== "all" && s.role !== roleFilter) return false;
    if (statusFilter === "open" && s.mass_assignments.length > 0) return false;
    if (statusFilter === "filled" && s.mass_assignments.length === 0) return false;
    if (statusFilter === "mine" && !s.mass_assignments.some((a) => a.user_id === currentUserId)) return false;
    if (search) {
      const hay = `${s.role} ${s.build_name} ${s.notes ?? ""} ${s.mass_assignments.map((a) => a.ign).join(" ")}`.toLowerCase();
      if (!hay.includes(search.toLowerCase())) return false;
    }
    return true;
  };

  const filtering = search !== "" || roleFilter !== "all" || partyFilter !== "all" || statusFilter !== "all";

  const openClaim = (slot: MassSlot) => {
    setClaimError(null);
    setClaimIgn(defaultIgn ?? "");
    setClaimSlot(slot);
  };

  const confirmClaim = async () => {
    if (!claimSlot) return;
    setClaimBusy(true);
    setClaimError(null);
    try {
      await onAction({ kind: "claim", slot: claimSlot, ign: claimIgn.trim() } as SlotAction & { ign: string });
      setClaimSlot(null);
    } catch (err) {
      setClaimError(friendlyClaimError(err instanceof MassSheetError ? err.code : "UNKNOWN"));
    } finally {
      setClaimBusy(false);
    }
  };

  return (
    <div className="space-y-4">
      {/* Toolbar — §21 search/filter */}
      <div className="flex flex-wrap items-center gap-2">
        <input
          type="search"
          className="field sm:w-64"
          placeholder="Search IGN, build, role…"
          value={search}
          onChange={(e) => setSearch(e.target.value)}
          aria-label="Search slots"
        />
        <select className="field sm:w-40" value={roleFilter} onChange={(e) => setRoleFilter(e.target.value)} aria-label="Filter by role">
          <option value="all">All roles</option>
          {roles.map((r) => <option key={r} value={r}>{r}</option>)}
        </select>
        <select className="field sm:w-44" value={partyFilter} onChange={(e) => setPartyFilter(e.target.value)} aria-label="Filter by party">
          <option value="all">All parties</option>
          {sheet.mass_parties.map((p) => <option key={p.id} value={p.id}>{p.name}</option>)}
        </select>
        <select className="field sm:w-40" value={statusFilter} onChange={(e) => setStatusFilter(e.target.value)} aria-label="Filter by status">
          <option value="all">All slots</option>
          <option value="open">Open only</option>
          <option value="filled">Filled only</option>
          {currentUserId && <option value="mine">My slots</option>}
        </select>
      </div>

      {/* Party grids — desktop: tables, mobile: stacked cards */}
      <div className="grid gap-4 lg:grid-cols-2 2xl:grid-cols-3">
        {sheet.mass_parties.map((party) => {
          const visibleSlots = party.mass_slots.filter((s) => matches(s, party.id));
          if (visibleSlots.length === 0 && filtering) return null;
          return (
            <section key={party.id} className="panel overflow-hidden p-0">
              <header className="border-b border-line-strong px-3 py-2">
                <h3 className="section-title">{party.name}</h3>
                {party.fill_note && (
                  <p className="mt-0.5 flex items-center gap-1 text-xs text-warn">★ {party.fill_note}</p>
                )}
              </header>

              {/* Desktop table */}
              <table className="hidden w-full text-sm sm:table">
                <thead>
                  <tr className="text-left text-xs uppercase tracking-wide text-faint">
                    <th className="px-3 py-2 font-semibold">Role</th>
                    <th className="px-3 py-2 font-semibold">Build</th>
                    <th className="px-3 py-2 font-semibold">IGN</th>
                    <th className="px-3 py-2 font-semibold">Status</th>
                    <th className="px-3 py-2" aria-label="Actions" />
                  </tr>
                </thead>
                <tbody>
                  {visibleSlots.map((slot, i) => (
                    <SlotRow
                      key={slot.id}
                      slot={slot}
                      zebra={i % 2 === 1}
                      currentUserId={currentUserId}
                      isAdmin={isAdmin}
                      editable={editable}
                      onAction={onAction}
                      onClaim={openClaim}
                    />
                  ))}
                </tbody>
              </table>

              {/* Mobile cards */}
              <div className="divide-y divide-line sm:hidden">
                {visibleSlots.map((slot) => (
                  <SlotCard
                    key={slot.id}
                    slot={slot}
                    currentUserId={currentUserId}
                    isAdmin={isAdmin}
                    editable={editable}
                    onAction={onAction}
                    onClaim={openClaim}
                  />
                ))}
              </div>
            </section>
          );
        })}
      </div>

      {/* Claim modal — IGN prefilled from profile (§14) */}
      <Modal open={Boolean(claimSlot)} onClose={() => setClaimSlot(null)} title="Claim slot">
        {claimSlot && (
          <form
            onSubmit={(e) => { e.preventDefault(); void confirmClaim(); }}
            className="space-y-3"
          >
            <p className="text-sm text-muted">
              {claimSlot.role} · <span className="font-mono text-[13px]">{claimSlot.build_name}</span>
              {claimSlot.priority === "high" && " · ★ High priority"}
            </p>
            <div>
              <label htmlFor="claim-ign" className="field-label">Your IGN</label>
              <input
                id="claim-ign"
                className="field"
                value={claimIgn}
                onChange={(e) => setClaimIgn(e.target.value)}
                placeholder="notvixol"
                maxLength={32}
                autoFocus
              />
              {defaultIgn ? <p className="field-hint">Prefilled from your profile — edit if you're on another character.</p> : null}
            </div>
            {claimError && <p className="text-sm text-danger" role="alert">{claimError}</p>}
            <div className="flex justify-end gap-2 pt-1">
              <Button type="button" variant="secondary" onClick={() => setClaimSlot(null)}>Cancel</Button>
              <Button type="submit" loading={claimBusy} disabled={claimIgn.trim().length < 2}>
                {claimBusy ? "Claiming…" : "Confirm"}
              </Button>
            </div>
          </form>
        )}
      </Modal>
    </div>
  );
}

function StatusBadge({ slot }: { slot: MassSlot }) {
  const claimed = slot.mass_assignments[0];
  if (claimed) return <Badge status="approved">● Filled</Badge>;
  if (slot.priority === "high") return <Badge status="pending">★ Priority</Badge>;
  return <Badge status="open">○ Open</Badge>;
}

function SlotRow({ slot, zebra, currentUserId, isAdmin, editable, onAction, onClaim }: {
  slot: MassSlot;
  zebra: boolean;
  currentUserId: string | null;
  isAdmin: boolean;
  editable: boolean;
  onAction: (action: SlotAction) => Promise<void> | void;
  onClaim: (slot: MassSlot) => void;
}) {
  const claimed = slot.mass_assignments[0];
  const mine = claimed && claimed.user_id === currentUserId;
  return (
    <tr className={zebra ? "bg-elevated/40" : undefined}>
      <td className="px-3 py-2 align-top">
        <div className="font-medium text-ink">{slot.role}</div>
        {slot.priority === "high" && <div className="text-xs text-warn">★ High priority</div>}
        {slot.notes && <div className="text-xs text-faint">{slot.notes}</div>}
      </td>
      <td className="px-3 py-2 align-top font-mono text-xs">
        {slot.build_name}
        {slot.tier_requirement && slot.tier_requirement !== "any" && (
          <span className="ml-1 text-brand">· {slot.tier_requirement}</span>
        )}
      </td>
      <td className="px-3 py-2 align-top font-semibold">{claimed ? claimed.ign : <span className="text-faint">—</span>}</td>
      <td className="px-3 py-2 align-top"><StatusBadge slot={slot} /></td>
      <td className="px-3 py-2 align-top text-right">
        <SlotActions slot={slot} mine={Boolean(mine)} claimed={Boolean(claimed)} isAdmin={isAdmin} editable={editable} onAction={onAction} onClaim={onClaim} />
      </td>
    </tr>
  );
}

function SlotCard({ slot, currentUserId, isAdmin, editable, onAction, onClaim }: {
  slot: MassSlot;
  currentUserId: string | null;
  isAdmin: boolean;
  editable: boolean;
  onAction: (action: SlotAction) => Promise<void> | void;
  onClaim: (slot: MassSlot) => void;
}) {
  const claimed = slot.mass_assignments[0];
  const mine = claimed && claimed.user_id === currentUserId;
  return (
    <div className="px-3 py-3">
      <div className="flex items-center justify-between gap-2">
        <div>
          <div className="text-sm font-medium text-ink">{slot.role} · <span className="font-mono text-xs">{slot.build_name}</span></div>
          <div className="text-sm font-semibold">{claimed ? claimed.ign : <span className="text-faint">Unfilled</span>}</div>
        </div>
        <StatusBadge slot={slot} />
      </div>
      <div className="mt-2">
        <SlotActions slot={slot} mine={Boolean(mine)} claimed={Boolean(claimed)} isAdmin={isAdmin} editable={editable} onAction={onAction} onClaim={onClaim} />
      </div>
    </div>
  );
}

function SlotActions({ slot, mine, claimed, isAdmin, editable, onAction, onClaim }: {
  slot: MassSlot;
  mine: boolean;
  claimed: boolean;
  isAdmin: boolean;
  editable: boolean;
  onAction: (action: SlotAction) => Promise<void> | void;
  onClaim: (slot: MassSlot) => void;
}) {
  if (isAdmin) {
    return claimed ? (
      <Button size="sm" variant="ghost" onClick={() => void onAction({ kind: "clear", slot })}>
        Clear
      </Button>
    ) : null;
  }
  if (!editable) return null;
  if (mine) {
    return <Button size="sm" variant="secondary" onClick={() => void onAction({ kind: "unclaim", slot })}>Unclaim</Button>;
  }
  if (claimed) return null;
  return <Button size="sm" onClick={() => onClaim(slot)}>Claim slot</Button>;
}

export { PRIORITY_LABEL };
