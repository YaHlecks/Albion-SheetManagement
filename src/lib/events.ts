/**
 * Event data layer — the app's core domain.
 *
 * THE MODEL: a slot is a SPREADSHEET ROW. Each row carries 0..n equipment
 * requirements (event_slot_requirements) across the full taxonomy
 * (Weapon/Head/Chest/Feet/Off-Hand/Mount/Cape/Bag/Other) — a DPS row can be
 * weapon-only, a tank row weapon+armor+shield, a battlemount row mount+weapon.
 * Roles are free-text labels; ROLES below are suggestions only.
 *
 * Reads are flat nested selects (one round-trip, no N+1). All writes go
 * through security-definer RPCs in supabase/migrations/0001_init.sql.
 */
import type { SupabaseClient } from "@supabase/supabase-js";

export type EventStatus = "draft" | "published" | "locked" | "completed" | "cancelled" | "archived";
export type SlotPriority = "high" | "normal" | "low";

/** Slot-requirement categories — matches the DB CHECK and the picker tabs. */
export const REQ_CATEGORIES = [
  "Weapon", "Head", "Chest", "Feet", "Off-Hand", "Mount", "Cape", "Bag", "Other",
] as const;
export type ReqCategory = (typeof REQ_CATEGORIES)[number];

export const EQUIPMENT_CATEGORIES = [
  "Weapon", "Head", "Chest", "Feet", "Off-Hand", "Mount", "Cape", "Bag", "Other",
] as const;

export const ROLES = [
  "Tank", "DPS", "Healer", "Support", "Caller", "Battlemount",
  "Frontline", "Backline", "Utility", "Scout", "Fill", "Other",
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

export interface EventSignup {
  id: string;
  slot_id: string;
  event_id: string;
  user_id: string;
  ign: string;
  note: string | null;
  signed_up_at: string;
}

export interface SlotRequirement {
  id?: string;
  slot_id?: string;
  category: ReqCategory | string;
  item: string;
  tier_requirement: string;
  sort_order: number;
}

export interface EventSlot {
  id: string;
  party_id: string;
  role: string;
  notes: string | null;
  priority: SlotPriority;
  required: boolean;
  sort_order: number;
  event_slot_requirements: SlotRequirement[];
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
    event_slots ( id, party_id, role, notes, priority, required, sort_order,
      event_slot_requirements ( id, slot_id, category, item, tier_requirement, sort_order ),
      event_signups ( id, slot_id, event_id, user_id, ign, note, signed_up_at ) )
  )` as const;

function sortEvent(event: EventFull): EventFull {
  event.event_parties.sort((a, b) => a.sort_order - b.sort_order);
  for (const p of event.event_parties) {
    p.event_slots.sort((a, b) => a.sort_order - b.sort_order);
    for (const s of p.event_slots) {
      s.event_slot_requirements?.sort((a, b) => a.sort_order - b.sort_order);
    }
  }
  return event;
}

/** One round-trip for the whole event — header, parties, slots, requirements, signups. */
export async function fetchEvent(supabase: SupabaseClient, eventId: string): Promise<EventFull | null> {
  const { data, error } = await supabase
    .from("events")
    .select(EVENT_SELECT)
    .eq("id", eventId)
    .maybeSingle();
  if (error) throw error;
  return data ? sortEvent(data as unknown as EventFull) : null;
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
      notes: string;
      priority: SlotPriority;
      required: boolean;
      requirements: Array<{
        id?: string;
        category: ReqCategory | string;
        item: string;
        tier_requirement: string;
      }>;
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

/** Save (create or update) via the save_event RPC — one atomic transaction. */
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
          notes: s.notes.trim() || null,
          priority: s.priority,
          required: s.required,
          sort_order: si,
          requirements: s.requirements
            .filter((r) => r.item.trim().length > 0)
            .map((r, ri) => ({
              category: r.category,
              item: r.item.trim(),
              tier_requirement: r.tier_requirement || "any",
              sort_order: ri,
            })),
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

/**
 * DRAFT vs PUBLISH validation (§10) — two different gates.
 *
 * Draft saving is gated ONLY by save_event's title check (2 chars), so
 * incomplete work always persists. Publish is the strict gate below: it runs
 * in the client BEFORE saving, and the database remains the final authority.
 */
export function validateForPublish(draft: EventDraft): string[] {
  const problems: string[] = [];
  if (draft.title.trim().length < 2) problems.push("An event name (2+ characters) is required.");
  if (!draft.event_date) problems.push("An event date is required.");
  if (!draft.massing_time) problems.push("A massing time is required.");
  if (draft.parties.length === 0) problems.push("Add at least one party.");
  const totalSlots = draft.parties.reduce((n, p) => n + p.slots.length, 0);
  if (totalSlots === 0) problems.push("Add at least one slot.");
  for (const [pi, p] of draft.parties.entries()) {
    for (const [si, s] of p.slots.entries()) {
      if (!s.role.trim()) problems.push(`Party ${pi + 1}, slot ${si + 1}: role is required.`);
    }
  }
  return problems;
}

/**
 * Technical detail from any save/RPC failure — shown alongside the friendly
 * message and logged to the console, so a database failure can never present
 * as "nothing happened" (§30/§32).
 */
export function technicalDetail(err: unknown): string {
  if (err instanceof EventError) {
    const explanations: Record<string, string> = {
      FORBIDDEN: "the database did not recognize this account as an admin (profile.is_platform_admin)",
      NOT_FOUND: "the event no longer exists (deleted by someone else)",
      INVALID_TITLE: "event title must be 2–120 characters",
      INVALID_STATUS: "invalid lifecycle status",
      UNAUTHENTICATED: "your session expired — sign in again",
    };
    return explanations[err.code] ?? `database rejected the operation (${err.code})`;
  }
  const e = err as { code?: unknown; message?: unknown; details?: unknown; hint?: unknown } | null;
  if (e && typeof e.message === "string" && e.message) {
    const head = [typeof e.code === "string" && e.code ? e.code : null, e.message].filter(Boolean).join(" ");
    const extra = [e.hint, e.details].filter((x) => typeof x === "string" && x).join(" | ");
    return extra ? `${head} (${extra})` : head;
  }
  return String(err);
}

/** Friendly copy; raw Postgres codes never reach users. */
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
 * One channel per event, cleaned up by the returned unsubscribe.
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

/** "Heavy Mace" + "Guardian Armor" → "Heavy Mace / Guardian Armor" for sheet cells. */
export function requirementLabel(slot: Pick<EventSlot, "event_slot_requirements">): string {
  const reqs = slot.event_slot_requirements ?? [];
  if (reqs.length === 0) return "—";
  return reqs
    .map((r) => (r.tier_requirement && r.tier_requirement !== "any" ? `${r.item} (${r.tier_requirement})` : r.item))
    .join(" / ");
}
