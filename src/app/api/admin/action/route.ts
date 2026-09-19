import { NextResponse } from "next/server";
import { getSessionContext } from "@/lib/auth";
import { createSupabaseServerClient } from "@/lib/supabase-server";
import { createAdminClient, hasServiceRole } from "@/lib/supabase-admin";
import { writeAudit, TRIGGER_RECORDED_ACTIONS } from "@/lib/audit";

const ALLOWED_ACTIONS = new Set([
  "approve_user",
  "reject_user",
  "suspend_user",
  "reactivate_user",
  "archive_user",
  "set_admin",
  "create_team",
  "rename_team",
  "archive_team",
  "restore_team",
  "set_team_status",
  "lock_sheet",
  "unlock_sheet",
  "add_member",
  "remove_member",
  "set_member_role",
]);

const AUDIT_ACTION_MAP: Record<string, string> = {
  approve_user: "USER_APPROVED",
  reject_user: "USER_REJECTED",
  suspend_user: "USER_SUSPENDED",
  reactivate_user: "USER_REACTIVATED",
  archive_user: "USER_ARCHIVED",
  set_admin: "PERMISSION_CHANGED",
  create_team: "TEAM_CREATED",
  rename_team: "TEAM_RENAMED",
  archive_team: "TEAM_ARCHIVED",
  restore_team: "TEAM_RESTORED",
  set_team_status: "TEAM_STATUS_CHANGED",
  lock_sheet: "SHEET_LOCKED",
  unlock_sheet: "SHEET_UNLOCKED",
  add_member: "MEMBER_ADDED",
  remove_member: "MEMBER_REMOVED",
  set_member_role: "PERMISSION_CHANGED",
};

export async function POST(req: Request) {
  try {
    const ctx = await getSessionContext();
    if (!ctx) return NextResponse.json({ ok: false, error: 401 }, { status: 401 });
    if (!ctx.isPlatformAdmin || !ctx.isApproved) {
      return NextResponse.json({ ok: false, error: 403 }, { status: 403 });
    }

    const body = await req.json().catch(() => null);
    if (!body || typeof body !== "object") {
      return NextResponse.json({ ok: false, error: "INVALID_BODY" }, { status: 400 });
    }

    const { action, targetUserId, teamId, memberId, payload } = body as {
      action?: unknown;
      targetUserId?: unknown;
      teamId?: unknown;
      memberId?: unknown;
      payload?: unknown;
    };

    if (typeof action !== "string" || !ALLOWED_ACTIONS.has(action)) {
      return NextResponse.json({ ok: false, error: "UNKNOWN_ACTION" }, { status: 400 });
    }

    const supabase = await createSupabaseServerClient();
    const params = {
      p_action: action,
      p_target_user_id: typeof targetUserId === "string" && targetUserId ? targetUserId : null,
      p_team_id: typeof teamId === "string" && teamId ? teamId : null,
      p_member_id: typeof memberId === "string" && memberId ? memberId : null,
      p_payload:
        payload && typeof payload === "object" ? (payload as Record<string, unknown>) : {},
    };

    let result: { ok?: boolean; error?: string; id?: string } | null = null;

    if (hasServiceRole()) {
      // Direct DB write via service role for full audit context (JWT claim is
      // absent). We write audit rows explicitly below with the actor id.
      const admin = createAdminClient();
      const { data, error } = await admin.rpc("admin_action", params);
      if (error) {
        console.error("[admin] action failed", action, error.message);
        return NextResponse.json({ ok: false, error: "ACTION_FAILED" }, { status: 500 });
      }
      result = data;
    } else {
      // Anon-key mode: the RPC enforces the admin check internally.
      const { data, error } = await supabase.rpc("admin_action", params);
      if (error) {
        console.error("[admin] action failed", action, error.message);
        return NextResponse.json({ ok: false, error: "ACTION_FAILED" }, { status: 500 });
      }
      result = data;
    }

    if (!result || result.ok === false) {
      return NextResponse.json(result ?? { ok: false, error: "UNKNOWN" });
    }

    // Explicit audit write with the acting admin's id — but only for actions
    // the database triggers do NOT already record (approval, membership,
    // lock events etc. are written by triggers inside admin_action).
    const auditAction = AUDIT_ACTION_MAP[action] ?? "PERMISSION_CHANGED";
    if (!TRIGGER_RECORDED_ACTIONS.has(auditAction)) {
      await writeAudit({
        action: auditAction as never,
        actorId: ctx.userId,
        targetUserId: params.p_target_user_id,
        teamId: params.p_team_id,
        meta: { admin_action: action, ...(params.p_payload as Record<string, unknown>) },
      });
    }

    return NextResponse.json({ ok: true, id: result.id ?? null });
  } catch (err) {
    console.error("[admin] unexpected error", err);
    return NextResponse.json({ ok: false, error: "SERVER_ERROR" }, { status: 500 });
  }
}
