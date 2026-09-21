/**
 * Event data layer — the app's core domain (§6).
 *
 * Reads are flat nested selects (one round-trip, no N+1). All writes go
 * through security-definer RPCs in supabase/migrations/0001_init.sql.
 */
import type { SupabaseClient } from "@supabase/supabase-js";

export type EventStatus = "draft" | "published" | "locked" | "completed" | "cancelled" | "archived";
export type SlotPriority = "high" | "normal" | "low";

export interface EventSignup {
  id: string;
  slot_id: string;
  event_id: string;
  user_id: string;
  ign: string;
  note: string | null;
  signed_up_at: string;
}

export interface EventSlot {
  id: string;
  party_id: string;
  role: string;
  equipment: string;
  tier_requirement: string;
  notes: string | null;
  priority: SlotPriority;
  required: boolean;
  sort_order: number;
  event_signups: EventSignup[];
}

export interface EventParty {
  id: string;
  event_id: string;
  name: string;
  fill_note: string | null;
  sort_order: number;
  event_slots: EventSlot[];
}

export interface EventRow {
  id: string;
  title: string;
  description: string | null;
  event_date: string | null;
  massing_time: string | null;
  timezone: string;
  location: string | null;
  portal: string | null;
  set_name: string | null;
  caller: string | null;
  instructions: string | null;
  status: EventStatus;
  is_template: boolean;
  created_at: string;
  updated_at: string;
}

export interface EventFull extends EventRow {
  event_parties: EventParty[];
}

export const EVENT_SELECT = `
  *,
  event_parties ( id, event_id, name, fill_note, sort_order,
    event_slots ( id, party_id, role, equipment, tier_requirement, notes, priority, required, sort_order,
      event_signups ( id, slot_id, event_id, user_id, ign, note, signed_up_at ) )
  )` as const;

export const ROLES = [
  "Tank", "DPS", "Healer", "Support", "Frontline", "Backline",
  "Utility", "Caller", "Scout", "Fill", "Other",
] as const;

export const TIMEZONES = [
  "UTC", "Europe/London", "Europe/Berlin", "Europe/Paris", "Europe/Moscow",
  "America/New_York", "America/Chicago", "America/Los_Angeles", "America/Sao_Paulo",
  "Asia/Tokyo", "Asia/Manila", "Asia/Singapore", "Australia/Sydney",
] as const;

export const FILL_NOTES = [
  "Fill Party 1 first", "Fill Party 2 first", "Fill Party 1 and 2 first",
  "Priority tanks", "Reserve party", "FILL 1st and 2nd PT First",
] as const;

export const TIER_OPTIONS = ["any", "T4", "T4.1", "T5", "T5.1", "T6", "T6.1", "T7", "T7.1", "T8", "T8.1"] as const;

function sortEvent(event: EventFull): EventFull {
  event.event_parties.sort((a, b) => a.sort_order - b.sort_order);
  for (const p of event.event_parties) p.event_slots.sort((a, b) => a.sort_order - b.sort_order);
  return event;
}

/** One round-trip for the whole event — header, parties, slots, signups. */
export async function fetchEvent(supabase: SupabaseClient, eventId: string): Promise<EventFull | null> {
  const { data, error } = await supabase
    .from("events")
    .select(EVENT_SELECT)
    .eq("id", eventId)
    .maybeSingle();
  if (error) throw error;
  return data ? sortEvent(data as EventFull) : null;
}

/** Events visible to the current user, newest first. */
export async function fetchEvents(supabase: SupabaseClient, opts?: {
  statuses?: EventStatus[];
  templates?: boolean;
}): Promise<EventRow[]> {
  let q = supabase
    .from("events")
    .select("*")
    .order("event_date", { ascending: true, nullsFirst: false })
    .order("created_at", { ascending: false });
  if (opts?.statuses?.length) q = q.in("status", opts.statuses);
  if (opts?.templates !== undefined) q = q.eq("is_template", opts.templates);
  const { data, error } = await q;
  if (error) throw error;
  return (data ?? []) as EventRow[];
}

export interface EventDraft {
  title: string;
  description: string;
  event_date: string;
  massing_time: string;
  timezone: string;
  location: string;
  portal: string;
  set_name: string;
  caller: string;
  instructions: string;
  is_template: boolean;
  parties: Array<{
    id?: string;
    name: string;
    fill_note: string;
    slots: Array<{
      id?: string;
      role: string;
      equipment: string;
      tier_requirement: string;
      notes: string;
      priority: SlotPriority;
      required: boolean;
      assignedIgn?: string | null;
    }>;
  }>;
}

export function emptyDraft(): EventDraft {
  return {
    title: "", description: "", event_date: "", massing_time: "", timezone: "UTC",
    location: "", portal: "", set_name: "", caller: "", instructions: "",
    is_template: false,
    parties: [{ name: "Party 1", fill_note: "", slots: [] }],
  };
}

/** Save (create or update) via the save_event RPC. */
export async function saveEvent(
  supabase: SupabaseClient,
  eventId: string | null,
  draft: EventDraft,
): Promise<{ id: string; created: boolean }> {
  const { data, error } = await supabase.rpc("save_event", {
    p_event_id: eventId,
    p_data: {
      title: draft.title.trim(),
      description: draft.description.trim() || null,
      event_date: draft.event_date || null,
      massing_time: draft.massing_time || null,
      timezone: draft.timezone,
      location: draft.location.trim() || null,
      portal: draft.portal.trim() || null,
      set_name: draft.set_name.trim() || null,
      caller: draft.caller.trim() || null,
      instructions: draft.instructions.trim() || null,
      is_template: draft.is_template,
      parties: draft.parties.map((p, pi) => ({
        id: p.id,
        name: p.name.trim() || `Party ${pi + 1}`,
        fill_note: p.fill_note.trim() || null,
        sort_order: pi,
        slots: p.slots.map((s, si) => ({
          id: s.id,
          role: s.role.trim() || "Fill",
          equipment: s.equipment.trim() || "TBD",
          tier_requirement: s.tier_requirement || "any",
          notes: s.notes.trim() || null,
          priority: s.priority,
          required: s.required,
          sort_order: si,
        })),
      })),
    },
  });
  if (error) throw error;
  const res = data as { ok: boolean; id?: string; created?: boolean; error?: string };
  if (!res?.ok) throw new EventError(res?.error ?? "UNKNOWN");
  return { id: res.id!, created: Boolean(res.created) };
}

export async function setEventStatus(supabase: SupabaseClient, eventId: string, status: EventStatus) {
  const { data, error } = await supabase.rpc("set_event_status", { p_event_id: eventId, p_status: status });
  if (error) throw error;
  const res = data as { ok: boolean; error?: string };
  if (!res?.ok) throw new EventError(res?.error ?? "UNKNOWN");
}

export async function duplicateEvent(supabase: SupabaseClient, eventId: string): Promise<string> {
  const { data, error } = await supabase.rpc("duplicate_event", { p_event_id: eventId });
  if (error) throw error;
  const res = data as { ok: boolean; id?: string; error?: string };
  if (!res?.ok) throw new EventError(res?.error ?? "UNKNOWN");
  return res.id!;
}

export async function claimEventSlot(supabase: SupabaseClient, slotId: string, note?: string) {
  const { data, error } = await supabase.rpc("claim_event_slot", { p_slot_id: slotId, p_note: note ?? null });
  if (error) throw error;
  const res = data as { ok: boolean; error?: string };
  if (!res?.ok) throw new EventError(res?.error ?? "UNKNOWN");
}

export async function leaveEventSlot(supabase: SupabaseClient, slotId: string) {
  const { data, error } = await supabase.rpc("leave_event_slot", { p_slot_id: slotId });
  if (error) throw error;
  const res = data as { ok: boolean; error?: string };
  if (!res?.ok) throw new EventError(res?.error ?? "UNKNOWN");
}

export async function adminSetSignup(supabase: SupabaseClient, slotId: string, userId: string | null) {
  const { data, error } = await supabase.rpc("admin_set_signup", { p_slot_id: slotId, p_user_id: userId });
  if (error) throw error;
  const res = data as { ok: boolean; error?: string };
  if (!res?.ok) throw new EventError(res?.error ?? "UNKNOWN");
}

export class EventError extends Error {
  code: string;
  constructor(code: string) {
    super(code);
    this.code = code;
  }
}

/** §42/§47 — friendly copy; raw Postgres codes never reach users. */
export function friendlyEventError(code: string): string {
  switch (code) {
    case "SLOT_TAKEN": return "That slot was just taken by someone else. Pick another open slot.";
    case "ALREADY_SIGNED_UP": return "You already have a slot in this event. Leave it first to switch.";
    case "EVENT_NOT_OPEN": return "This event is not open for signups right now.";
    case "ACCOUNT_NOT_APPROVED": return "Your account is awaiting approval, so you can't sign up yet.";
    case "NOT_SIGNED_UP": return "That slot isn't signed by you.";
    case "USER_NOT_APPROVED": return "That member's account is not approved.";
    case "INVALID_TITLE": return "Event title must be 2–120 characters.";
    case "IGN_TAKEN": return "That IGN is already in use by another account.";
    case "UNAUTHENTICATED": return "Please sign in again.";
    default: return "Something went wrong. Please try again.";
  }
}

/**
 * Realtime for one event: signup changes + event status changes.
 * One channel per event, cleaned up by the returned unsubscribe (§36).
 */
export function subscribeToEvent(
  supabase: SupabaseClient,
  eventId: string,
  onChange: (kind: "signup" | "status") => void,
): () => void {
  const channel = supabase
    .channel(`event-${eventId}`)
    .on("postgres_changes",
      { event: "*", schema: "public", table: "event_signups", filter: `event_id=eq.${eventId}` },
      () => onChange("signup"))
    .on("postgres_changes",
      { event: "UPDATE", schema: "public", table: "events", filter: `id=eq.${eventId}` },
      () => onChange("status"))
    .subscribe();
  return () => {
    void supabase.removeChannel(channel);
  };
}

export function eventStats(event: EventFull | null) {
  const slots = event?.event_parties.flatMap((p) => p.event_slots) ?? [];
  const filled = slots.filter((s) => s.event_signups.length > 0).length;
  const perParty = (event?.event_parties ?? []).map((p) => ({
    partyId: p.id, name: p.name,
    filled: p.event_slots.filter((s) => s.event_signups.length > 0).length,
    total: p.event_slots.length,
  }));
  return { filled, open: slots.length - filled, total: slots.length, perParty };
}

/** "2026-09-22" + "13:30" + tz → display label in that timezone. */
export function formatMassingTime(date: string | null, time: string | null, tz: string): string {
  if (!date || !time) return "Time not set";
  try {
    const at = new Date(`${date}T${time}:00Z`);
    return `${new Intl.DateTimeFormat("en-GB", {
      timeZone: tz, dateStyle: "medium", timeStyle: "short",
    }).format(at)} (${tz})`;
  } catch {
    return `${date} ${time} (${tz})`;
  }
}
