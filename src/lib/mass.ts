/**
 * Albion mass-sheet data layer.
 *
 * All reads are single flat selects (Supabase nests the relationships in one
 * round-trip — no N+1). All writes go through the security-definer RPCs from
 * migration 0004, which re-verify identity/state server-side.
 */
import type { SupabaseClient } from "@supabase/supabase-js";

export type MassSheetStatus = "draft" | "published" | "locked" | "archived";
export type SlotPriority = "high" | "normal" | "low";

export interface MassAssignment {
  id: string;
  slot_id: string;
  user_id: string;
  ign: string;
  assigned_at: string;
  assigned_by: string | null;
}

export interface MassSlot {
  id: string;
  party_id: string;
  role: string;
  build_name: string;
  priority: SlotPriority;
  notes: string | null;
  required: boolean;
  sort_order: number;
  mass_assignments: MassAssignment[];
}

export interface MassParty {
  id: string;
  sheet_id: string;
  name: string;
  fill_note: string | null;
  sort_order: number;
  mass_slots: MassSlot[];
}

export interface MassSheet {
  id: string;
  team_id: string;
  title: string;
  location: string | null;
  set_name: string | null;
  mass_at: string | null;
  timezone: string | null;
  description: string | null;
  instructions: string | null;
  status: MassSheetStatus;
  created_by: string | null;
  created_at: string;
  updated_at: string;
  teams?: { id: string; name: string } | null;
}

export interface MassSheetFull extends MassSheet {
  mass_parties: MassParty[];
}

/** Builder state (draft in the wizard — not yet DB rows). */
export interface SlotDraft {
  id?: string;
  role: string;
  build_name: string;
  priority: SlotPriority;
  notes?: string;
  required: boolean;
}

export interface PartyDraft {
  id?: string;
  name: string;
  fill_note?: string;
  slots: SlotDraft[];
}

export interface SheetDraft {
  title: string;
  location: string;
  set_name: string;
  /** ISO-ish "YYYY-MM-DD" + "HH:mm" + IANA tz; converted to UTC before save. */
  mass_date: string;
  mass_time: string;
  timezone: string;
  description: string;
  instructions: string;
  team_id: string;
  parties: PartyDraft[];
}

const SHEET_SELECT = `
  *,
  teams ( id, name ),
  mass_parties ( id, sheet_id, name, fill_note, sort_order,
    mass_slots ( id, party_id, role, build_name, priority, notes, required, sort_order,
      mass_assignments ( id, slot_id, user_id, ign, assigned_at, assigned_by ) )
  )` as const;

function sortSheet(sheet: MassSheetFull): MassSheetFull {
  sheet.mass_parties.sort((a, b) => a.sort_order - b.sort_order);
  for (const p of sheet.mass_parties) {
    p.mass_slots.sort((a, b) => a.sort_order - b.sort_order);
  }
  return sheet;
}

/** One round-trip for the whole sheet — header, parties, slots, assignments. */
export async function fetchMassSheet(
  supabase: SupabaseClient,
  sheetId: string,
): Promise<MassSheetFull | null> {
  const { data, error } = await supabase
    .from("mass_sheets")
    .select(SHEET_SELECT)
    .eq("id", sheetId)
    .maybeSingle();
  if (error) throw error;
  return data ? sortSheet(data as MassSheetFull) : null;
}

/** Sheets visible to the current user (optionally filtered to one team). */
export async function fetchMassSheets(
  supabase: SupabaseClient,
  opts?: { teamId?: string },
): Promise<MassSheet[]> {
  let q = supabase
    .from("mass_sheets")
    .select("*, teams ( id, name )")
    .order("mass_at", { ascending: false, nullsFirst: false });
  if (opts?.teamId) q = q.eq("team_id", opts.teamId);
  const { data, error } = await q;
  if (error) throw error;
  return (data ?? []) as MassSheet[];
}

/** UTC instant from the wizard's date/time/timezone fields. */
export function composeMassAt(date: string, time: string, timezone: string): string | null {
  if (!date || !time) return null;
  try {
    // Interpret the wall-clock time in the chosen timezone via Intl.
    const [y, m, d] = date.split("-").map(Number);
    const [hh, mm] = time.split(":").map(Number);
    if (!y || !m || !d || Number.isNaN(hh) || Number.isNaN(mm)) return null;
    const guess = Date.UTC(y, m - 1, d, hh, mm);
    const offset = tzOffsetMs(timezone, new Date(guess));
    return new Date(guess - offset).toISOString();
  } catch {
    return null;
  }
}

function tzOffsetMs(timezone: string, at: Date): number {
  try {
    const dtf = new Intl.DateTimeFormat("en-US", {
      timeZone: timezone,
      hour12: false,
      year: "numeric", month: "2-digit", day: "2-digit",
      hour: "2-digit", minute: "2-digit", second: "2-digit",
    });
    const parts = dtf.formatToParts(at);
    const get = (t: string) => Number(parts.find((p) => p.type === t)?.value);
    const asUTC = Date.UTC(
      get("year"), get("month") - 1, get("day"),
      get("hour") % 24, get("minute"), get("second"),
    );
    return asUTC - at.getTime();
  } catch {
    return 0;
  }
}

export interface SaveSheetPayload {
  title: string;
  team_id: string;
  location?: string | null;
  set_name?: string | null;
  mass_at?: string | null;
  timezone?: string | null;
  description?: string | null;
  instructions?: string | null;
  parties: Array<{
    id?: string;
    name: string;
    fill_note?: string | null;
    sort_order: number;
    slots: Array<{
      id?: string;
      role: string;
      build_name: string;
      priority: SlotPriority;
      notes?: string | null;
      required: boolean;
      sort_order: number;
    }>;
  }>;
}

/** Create/update a whole sheet in one RPC (structure-only changes keep assignments on untouched slots). */
export async function saveMassSheet(
  supabase: SupabaseClient,
  sheetId: string | null,
  payload: SaveSheetPayload,
): Promise<{ id: string; created: boolean }> {
  const { data, error } = await supabase.rpc("save_mass_sheet", {
    p_sheet_id: sheetId,
    p_data: payload,
  });
  if (error) throw error;
  const res = data as { ok: boolean; id?: string; created?: boolean; error?: string };
  if (!res?.ok) throw new MassSheetError(res?.error ?? "UNKNOWN");
  return { id: res.id!, created: Boolean(res.created) };
}

export async function setMassSheetStatus(supabase: SupabaseClient, sheetId: string, status: MassSheetStatus) {
  const { data, error } = await supabase.rpc("set_mass_sheet_status", { p_sheet_id: sheetId, p_status: status });
  if (error) throw error;
  const res = data as { ok: boolean; error?: string };
  if (!res?.ok) throw new MassSheetError(res?.error ?? "UNKNOWN");
}

export async function duplicateMassSheet(supabase: SupabaseClient, sheetId: string): Promise<string> {
  const { data, error } = await supabase.rpc("duplicate_mass_sheet", { p_sheet_id: sheetId });
  if (error) throw error;
  const res = data as { ok: boolean; id?: string; error?: string };
  if (!res?.ok) throw new MassSheetError(res?.error ?? "UNKNOWN");
  return res.id!;
}

export async function claimMassSlot(supabase: SupabaseClient, slotId: string, ign: string) {
  const { data, error } = await supabase.rpc("claim_mass_slot", { p_slot_id: slotId, p_ign: ign });
  if (error) throw error;
  const res = data as { ok: boolean; error?: string };
  if (!res?.ok) throw new MassSheetError(res?.error ?? "UNKNOWN");
}

export async function unclaimMassSlot(supabase: SupabaseClient, slotId: string) {
  const { data, error } = await supabase.rpc("unclaim_mass_slot", { p_slot_id: slotId });
  if (error) throw error;
  const res = data as { ok: boolean; error?: string };
  if (!res?.ok) throw new MassSheetError(res?.error ?? "UNKNOWN");
}

export async function adminSetSlotAssignment(
  supabase: SupabaseClient,
  slotId: string,
  userId: string | null,
  ign?: string | null,
) {
  const { data, error } = await supabase.rpc("admin_set_slot_assignment", {
    p_slot_id: slotId,
    p_user_id: userId,
    p_ign: ign ?? null,
  });
  if (error) throw error;
  const res = data as { ok: boolean; error?: string };
  if (!res?.ok) throw new MassSheetError(res?.error ?? "UNKNOWN");
}

export class MassSheetError extends Error {
  code: string;
  constructor(code: string) {
    super(code);
    this.code = code;
  }
}

/** §38 — never surface raw 42501-style text to members. */
export function friendlyClaimError(code: string): string {
  switch (code) {
    case "SLOT_TAKEN": return "That slot was just claimed by someone else. Pick another open slot.";
    case "SHEET_NOT_OPEN": return "This mass is not open for changes right now (locked or unpublished).";
    case "ACCOUNT_NOT_APPROVED": return "Your account is awaiting approval, so you can't fill slots yet.";
    case "NOT_TEAM_MEMBER": return "You are not a member of this mass's team.";
    case "INVALID_IGN": return "Enter a valid IGN (2–32 characters).";
    case "NOT_CLAIMED_BY_YOU": return "That slot isn't claimed by you.";
    case "UNAUTHENTICATED": return "Please sign in again.";
    default: return "Something went wrong. Please try again.";
  }
}

/**
 * Realtime updates for a sheet: assignment changes and status changes.
 * Returns an unsubscribe function. One channel per sheet — callers must
 * clean it up on unmount (§18: no duplicate subscriptions, no loops).
 */
export function subscribeToMassSheet(
  supabase: SupabaseClient,
  sheetId: string,
  onChange: (kind: "assignment" | "status") => void,
): () => void {
  const channel = supabase
    .channel(`mass-sheet-${sheetId}`)
    .on(
      "postgres_changes",
      { event: "*", schema: "public", table: "mass_assignments" },
      () => onChange("assignment"),
    )
    .on(
      "postgres_changes",
      { event: "UPDATE", schema: "public", table: "mass_sheets", filter: `id=eq.${sheetId}` },
      () => onChange("status"),
    )
    .subscribe();
  return () => {
    void supabase.removeChannel(channel);
  };
}

/** Fill statistics for admin live view (§19). Computed client-side from the flat fetch. */
export function sheetStats(sheet: MassSheetFull | null) {
  const slots = sheet?.mass_parties.flatMap((p) => p.mass_slots) ?? [];
  const filled = slots.filter((s) => s.mass_assignments.length > 0).length;
  const total = slots.length;
  const perParty = (sheet?.mass_parties ?? []).map((p) => {
    const filledP = p.mass_slots.filter((s) => s.mass_assignments.length > 0).length;
    return { partyId: p.id, name: p.name, filled: filledP, total: p.mass_slots.length };
  });
  return { filled, open: total - filled, total, perParty };
}
