/**
 * Notification data layer — the app↔database contract in one place.
 *
 * Authoritative schema (supabase/migrations/0001_init.sql):
 *   notifications (id, user_id, title, body, kind, link, read, created_at)
 *
 * HISTORY: the UI previously selected a `type` column that does not exist
 * (42703 "column notifications.type does not exist" / PGRST204), which made
 * the notification bell and the /notifications page silently load nothing.
 * These helpers are the single correct contract — always import from here.
 */
import type { SupabaseClient } from "@supabase/supabase-js";

/** Exact column list the database actually has — `kind`, never `type`. */
export const NOTIFICATION_SELECT = "id, title, body, kind, read, link, created_at" as const;

export type NotificationKind = "info" | "success" | "error" | "event";

export interface NotificationRow {
  id: string;
  title: string;
  body: string | null;
  kind: NotificationKind;
  read: boolean;
  link: string | null;
  created_at: string;
}

const KINDS: ReadonlySet<string> = new Set(["info", "success", "error", "event"]);

/** Coerce a DB row into the strict row shape (defensive against older rows). */
export function toNotificationRow(raw: Record<string, unknown>): NotificationRow {
  const kind = typeof raw.kind === "string" && KINDS.has(raw.kind) ? raw.kind : "info";
  return {
    id: String(raw.id),
    title: String(raw.title ?? ""),
    body: (raw.body as string | null) ?? null,
    kind: kind as NotificationKind,
    read: Boolean(raw.read),
    link: (raw.link as string | null) ?? null,
    created_at: String(raw.created_at ?? new Date().toISOString()),
  };
}

/** Fetch the caller's newest notifications through RLS. */
export async function fetchNotifications(
  supabase: SupabaseClient,
  limit = 50,
): Promise<NotificationRow[]> {
  const { data, error } = await supabase
    .from("notifications")
    .select(NOTIFICATION_SELECT)
    .order("created_at", { ascending: false })
    .limit(limit);
  if (error) throw error;
  return (data ?? []).map((r) => toNotificationRow(r as Record<string, unknown>));
}

/** Visual tone for a notification kind (dot / text colors). */
export function notificationTone(kind: NotificationKind): string {
  switch (kind) {
    case "success": return "success";
    case "error": return "danger";
    case "event": return "brand";
    default: return "info";
  }
}
