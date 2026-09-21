import { NextResponse } from "next/server";
import { getSessionContext } from "@/lib/auth";
import { createSupabaseServerClient } from "@/lib/supabase-server";
import { createAdminClient, hasServiceRole } from "@/lib/supabase-admin";

const ALLOWED_ACTIONS = new Set([
  "approve_user",
  "reject_user",
  "suspend_user",
  "reactivate_user",
  "archive_user",
  "set_admin",
]);

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

    const { action, targetUserId, payload } = body as {
      action?: unknown;
      targetUserId?: unknown;
      payload?: unknown;
    };

    if (typeof action !== "string" || !ALLOWED_ACTIONS.has(action)) {
      return NextResponse.json({ ok: false, error: "UNKNOWN_ACTION" }, { status: 400 });
    }
    if (typeof targetUserId !== "string" || !targetUserId) {
      return NextResponse.json({ ok: false, error: "MISSING_TARGET" }, { status: 400 });
    }

    const params = {
      p_action: action,
      p_target_user_id: targetUserId,
      p_payload: payload && typeof payload === "object" ? (payload as Record<string, unknown>) : {},
    };

    // The admin_user_action RPC re-verifies the admin role inside the
    // database — the route check above is only fast-fail UX.
    const supabase = hasServiceRole() ? createAdminClient() : await createSupabaseServerClient();
    const { data, error } = await supabase.rpc("admin_user_action", params);
    if (error) {
      console.error("[admin] user action failed", action, error.message);
      return NextResponse.json({ ok: false, error: "ACTION_FAILED" }, { status: 500 });
    }

    const result = data as { ok?: boolean; error?: string } | null;
    if (!result || result.ok === false) {
      return NextResponse.json(result ?? { ok: false, error: "UNKNOWN" });
    }

    return NextResponse.json({ ok: true });
  } catch (err) {
    console.error("[admin] unexpected error", err);
    return NextResponse.json({ ok: false, error: "SERVER_ERROR" }, { status: 500 });
  }
}
