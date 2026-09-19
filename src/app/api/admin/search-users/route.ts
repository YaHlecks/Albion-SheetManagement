import { NextResponse } from "next/server";
import { getSessionContext } from "@/lib/auth";
import { createSupabaseServerClient } from "@/lib/supabase-server";
import { createAdminClient, hasServiceRole } from "@/lib/supabase-admin";

export async function GET(req: Request) {
  try {
    const ctx = await getSessionContext();
    if (!ctx) return NextResponse.json({ error: 401 }, { status: 401 });
    if (!ctx.isPlatformAdmin || !ctx.isApproved) {
      return NextResponse.json({ error: 403 }, { status: 403 });
    }

    const { searchParams } = new URL(req.url);
    const q = (searchParams.get("q") ?? "").trim().slice(0, 60);
    const teamId = searchParams.get("teamId");

    const supabase = hasServiceRole() ? createAdminClient() : await createSupabaseServerClient();

    let query = supabase
      .from("profiles")
      .select("id, ign, status")
      .eq("status", "approved")
      .order("ign", { ascending: true })
      .limit(15);

    if (q) query = query.ilike("ign", `%${q}%`);

    const { data, error } = await query;
    if (error) {
      console.error("[admin] user search failed", error.message);
      return NextResponse.json({ users: [] }, { status: 500 });
    }

    // Exclude users already in the team.
    let memberIds = new Set<string>();
    if (teamId) {
      const { data: existing } = await supabase
        .from("team_members")
        .select("user_id")
        .eq("team_id", teamId);
      memberIds = new Set((existing ?? []).map((m) => m.user_id));
    }

    return NextResponse.json({
      users: (data ?? []).filter((u) => !memberIds.has(u.id)),
    });
  } catch (err) {
    console.error("[admin] search unexpected error", err);
    return NextResponse.json({ users: [] }, { status: 500 });
  }
}
