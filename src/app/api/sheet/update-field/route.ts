import { NextResponse } from "next/server";
import { createSupabaseServerClient } from "@/lib/supabase-server";

const VALID_FIELDS = ["role", "weapon", "availability", "notes"];

export async function POST(req: Request) {
  try {
    const body = await req.json().catch(() => null);
    if (!body || typeof body !== "object") {
      return NextResponse.json({ ok: false, error: "INVALID_BODY" }, { status: 400 });
    }

    const { memberId, field, value } = body as { memberId?: unknown; field?: unknown; value?: unknown };

    if (typeof memberId !== "string" || !memberId) {
      return NextResponse.json({ ok: false, error: "INVALID_BODY" }, { status: 400 });
    }
    if (typeof field !== "string" || !VALID_FIELDS.includes(field)) {
      return NextResponse.json({ ok: false, error: "INVALID_FIELD" }, { status: 400 });
    }
    if (value !== null && typeof value !== "string") {
      return NextResponse.json({ ok: false, error: "INVALID_VALUE" }, { status: 400 });
    }

    // Session check: only authenticated calls proceed. All authorization
    // (ownership, lock, status) is re-verified inside the database RPC.
    const supabase = await createSupabaseServerClient();
    const {
      data: { user },
    } = await supabase.auth.getUser();

    if (!user) {
      return NextResponse.json({ ok: false, error: 401 }, { status: 401 });
    }

    const trimmed = typeof value === "string" ? value.slice(0, 400) : "";
    const { data, error } = await supabase.rpc("update_member_field", {
      p_member_id: memberId,
      p_field: field,
      p_value: trimmed,
    });

    if (error) {
      console.error("[sheet] update_member_field failed", error.message);
      return NextResponse.json({ ok: false, error: "RPC_FAILED" }, { status: 500 });
    }

    return NextResponse.json(data ?? { ok: false, error: "UNKNOWN" });
  } catch (err) {
    console.error("[sheet] unexpected error", err);
    return NextResponse.json({ ok: false, error: "SERVER_ERROR" }, { status: 500 });
  }
}
