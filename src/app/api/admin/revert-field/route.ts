import { NextResponse } from "next/server";
import { getSessionContext, AuthError } from "@/lib/auth";
import { createSupabaseServerClient } from "@/lib/supabase-server";
import { createAdminClient, hasServiceRole } from "@/lib/supabase-admin";
import { writeAudit } from "@/lib/audit";
import { TEAM_ROLES } from "@/lib/auth";

const VALID_FIELDS = ["role", "weapon", "availability", "notes"];

export async function POST(req: Request) {
  try {
    const ctx = await getSessionContext();
    if (!ctx) {
      return NextResponse.json({ ok: false, error: 401 }, { status: 401 });
    }
    if (!ctx.isPlatformAdmin || !ctx.isApproved) {
      return NextResponse.json({ ok: false, error: 403 }, { status: 403 });
    }

    const body = await req.json().catch(() => null);
    if (!body || typeof body !== "object") {
      return NextResponse.json({ ok: false, error: "INVALID_BODY" }, { status: 400 });
    }

    const { memberId, field, previousValue } = body as {
      memberId?: unknown;
      field?: unknown;
      previousValue?: unknown;
    };

    if (typeof memberId !== "string" || !memberId) {
      return NextResponse.json({ ok: false, error: "INVALID_BODY" }, { status: 400 });
    }
    if (typeof field !== "string" || !VALID_FIELDS.includes(field)) {
      return NextResponse.json({ ok: false, error: "INVALID_FIELD" }, { status: 400 });
    }
    if (field === "role" && typeof previousValue === "string" && !TEAM_ROLES.includes(previousValue as never)) {
      return NextResponse.json({ ok: false, error: "INVALID_VALUE" }, { status: 400 });
    }
    if (previousValue !== null && typeof previousValue !== "string") {
      return NextResponse.json({ ok: false, error: "INVALID_VALUE" }, { status: 400 });
    }

    const supabase = await createSupabaseServerClient();

    // Look up the member row (RLS-readable for admins).
    const { data: member, error: memberErr } = await supabase
      .from("team_members")
      .select("id, team_id, user_id, role, weapon, availability, notes")
      .eq("id", memberId)
      .maybeSingle();

    if (memberErr || !member) {
      return NextResponse.json({ ok: false, error: "NOT_FOUND" }, { status: 404 });
    }

    const prev = (previousValue as string | null) ?? "";
    const { data, error } = await supabase.rpc("revert_member_field", {
      p_member_id: memberId,
      p_field: field,
      p_previous_value: prev,
    });

    if (error) {
      console.error("[admin] revert_member_field failed", error.message);
      return NextResponse.json({ ok: false, error: "RPC_FAILED" }, { status: 500 });
    }
    if (data && data.ok === false) {
      return NextResponse.json(data);
    }

    await writeAudit({
      action: "CHANGE_REVERTED",
      actorId: ctx.userId,
      targetUserId: member.user_id,
      teamId: member.team_id,
      meta: {
        field,
        reverted_to: prev,
        previous_value: (member as Record<string, unknown>)[field] ?? null,
        member_id: memberId,
      },
    });

    // Notify the affected member.
    try {
      if (hasServiceRole()) {
        const admin = createAdminClient();
        await admin.rpc("notify_user", {
          p_user_id: member.user_id,
          p_title: "A change was reverted",
          p_body: `An administrator reverted your ${field} on a team sheet.`,
          p_type: "warning",
          p_link: null,
        });
      } else {
        await supabase.rpc("notify_user", {
          p_user_id: member.user_id,
          p_title: "A change was reverted",
          p_body: `An administrator reverted your ${field} on a team sheet.`,
          p_type: "warning",
          p_link: null,
        });
      }
    } catch (notifyErr) {
      console.error("[admin] revert notification failed", notifyErr);
    }

    return NextResponse.json({ ok: true });
  } catch (err) {
    if (err instanceof AuthError) {
      return NextResponse.json({ ok: false, error: err.code }, { status: 403 });
    }
    console.error("[admin] revert unexpected error", err);
    return NextResponse.json({ ok: false, error: "SERVER_ERROR" }, { status: 500 });
  }
}
