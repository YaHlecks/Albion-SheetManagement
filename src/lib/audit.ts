import { createSupabaseServerClient } from "./supabase-server";
import { createAdminClient, hasServiceRole } from "./supabase-admin";

export type AuditAction =
  | "USER_REGISTERED"
  | "USER_APPROVED"
  | "USER_REJECTED"
  | "USER_SUSPENDED"
  | "USER_REACTIVATED"
  | "USER_ARCHIVED"
  | "USER_LOGIN"
  | "USER_LOGOUT"
  | "EVENT_CREATED"
  | "EVENT_UPDATED"
  | "EVENT_PUBLISHED"
  | "EVENT_LOCKED"
  | "EVENT_COMPLETED"
  | "EVENT_CANCELLED"
  | "EVENT_ARCHIVED"
  | "EVENT_RESTORED"
  | "EVENT_DUPLICATED"
  | "SIGNUP_CREATED"
  | "SIGNUP_REMOVED"
  | "SIGNUP_MOVED"
  | "PERMISSION_CHANGED";

export interface AuditEvent {
  action: AuditAction;
  actorId: string | null;
  targetUserId?: string | null;
  eventId?: string | null;
  meta?: Record<string, unknown>;
}

/**
 * Actions the database RPCs already record when they fire — the API route
 * must NOT write these again (would duplicate).
 */
export const RPC_RECORDED_ACTIONS = new Set<string>([
  "USER_APPROVED",
  "USER_REJECTED",
  "USER_SUSPENDED",
  "USER_REACTIVATED",
  "USER_ARCHIVED",
  "EVENT_CREATED",
  "EVENT_UPDATED",
  "EVENT_PUBLISHED",
  "EVENT_LOCKED",
  "EVENT_COMPLETED",
  "EVENT_CANCELLED",
  "EVENT_ARCHIVED",
  "EVENT_RESTORED",
  "EVENT_DUPLICATED",
  "SIGNUP_CREATED",
  "SIGNUP_REMOVED",
  "SIGNUP_MOVED",
  "PERMISSION_CHANGED",
]);

/**
 * Writes an audit event. Audit writes are append-only and must never
 * interrupt the main operation, so failures are logged and swallowed.
 *
 * Service-role inserts bypass RLS; otherwise the caller's own session writes
 * (audit_logs insert policy = admin-only, matching the callers of this lib).
 */
export async function writeAudit(event: AuditEvent): Promise<void> {
  try {
    if (hasServiceRole()) {
      const admin = createAdminClient();
      const { error } = await admin.from("audit_logs").insert({
        action: event.action,
        actor_id: event.actorId,
        target_user_id: event.targetUserId ?? null,
        event_id: event.eventId ?? null,
        meta: event.meta ?? {},
      });
      if (error) throw error;
    } else {
      const supabase = await createSupabaseServerClient();
      const { error } = await supabase.from("audit_logs").insert({
        action: event.action,
        actor_id: event.actorId,
        target_user_id: event.targetUserId ?? null,
        event_id: event.eventId ?? null,
        meta: event.meta ?? {},
      });
      if (error) throw error;
    }
  } catch (err) {
    console.error("[audit] write failed (non-fatal)", event.action, err);
  }
}
