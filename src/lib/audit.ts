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
  | "TEAM_CREATED"
  | "TEAM_RENAMED"
  | "TEAM_ARCHIVED"
  | "TEAM_RESTORED"
  | "TEAM_STATUS_CHANGED"
  | "TEAM_OPENED"
  | "MEMBER_ADDED"
  | "MEMBER_REMOVED"
  | "SHEET_LOCKED"
  | "SHEET_UNLOCKED"
  | "FIELD_UPDATED"
  | "CHANGE_REVERTED"
  | "PERMISSION_CHANGED";

export interface AuditEvent {
  action: AuditAction;
  actorId: string | null;
  targetUserId?: string | null;
  teamId?: string | null;
  meta?: Record<string, unknown>;
}

/**
 * Actions that the database triggers already record when they fire. When an
 * admin action goes through the admin_action RPC the DB writes these events
 * itself, so the API route must NOT write them again (would duplicate).
 */
export const TRIGGER_RECORDED_ACTIONS = new Set<string>([
  "USER_APPROVED",
  "USER_REJECTED",
  "USER_SUSPENDED",
  "USER_REACTIVATED",
  "USER_ARCHIVED",
  "TEAM_RENAMED",
  "TEAM_ARCHIVED",
  "TEAM_OPENED",
  "MEMBER_ADDED",
  "MEMBER_REMOVED",
  "SHEET_LOCKED",
  "SHEET_UNLOCKED",
  "FIELD_UPDATED",
]);

let cachedUserClient: Awaited<ReturnType<typeof createSupabaseServerClient>> | null = null;

async function getUserClient() {
  if (!cachedUserClient) {
    cachedUserClient = await createSupabaseServerClient();
  }
  return cachedUserClient;
}

/**
 * Writes an audit event. Audit writes are append-only and must never
 * interrupt the main operation, so failures are logged and swallowed.
 *
 * Service-role inserts bypass RLS; otherwise the security-definer log_audit
 * RPC is used, which stamps the caller as actor.
 */
export async function writeAudit(event: AuditEvent): Promise<void> {
  try {
    if (hasServiceRole()) {
      const admin = createAdminClient();
      const { error } = await admin.from("audit_logs").insert({
        action: event.action,
        actor_id: event.actorId,
        target_user_id: event.targetUserId ?? null,
        team_id: event.teamId ?? null,
        meta: event.meta ?? {},
      });
      if (error) throw error;
    } else {
      const supabase = await getUserClient();
      const { error } = await supabase.rpc("log_audit", {
        p_action: event.action,
        p_target_user_id: event.targetUserId ?? null,
        p_team_id: event.teamId ?? null,
        p_meta: event.meta ?? {},
      });
      if (error) throw error;
    }
  } catch (err) {
    // Never let audit failures break the user-facing operation.
    console.error("[audit] failed to write audit event", event.action, err);
  }
}
