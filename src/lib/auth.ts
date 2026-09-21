import { cache } from "react";
import { createSupabaseServerClient } from "./supabase-server";
import { createAdminClient, hasServiceRole } from "./supabase-admin";

export type AccountStatus = "pending" | "approved" | "rejected" | "suspended" | "archived";

export interface SessionContext {
  userId: string;
  email: string;
  profile: {
    id: string;
    ign: string;
    discord: string | null;
    status: AccountStatus;
    isPlatformAdmin: boolean;
    createdAt: string;
    lastLoginAt: string | null;
  } | null;
  isApproved: boolean;
  isPlatformAdmin: boolean;
}

/**
 * Resolve the current session: auth user + profile row + status flags.
 * Returns null when not signed in. Cached per request.
 */
export const getSessionContext = cache(async (): Promise<SessionContext | null> => {
  const supabase = await createSupabaseServerClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();

  if (!user) return null;

  let profile: SessionContext["profile"] = null;
  let isPlatformAdmin = false;
  if (hasServiceRole()) {
    const admin = createAdminClient();
    const { data, error } = await admin
      .from("profiles")
      .select("id, ign, discord, status, is_platform_admin, created_at, last_login_at")
      .eq("id", user.id)
      .maybeSingle();
    if (data) {
      profile = {
        id: data.id,
        ign: data.ign,
        discord: data.discord ?? null,
        status: data.status as AccountStatus,
        isPlatformAdmin: Boolean(data.is_platform_admin),
        createdAt: data.created_at,
        lastLoginAt: data.last_login_at ?? null,
      };
    } else if (error) {
      // DATABASE/RLS failure — must never be interpreted as "pending".
      console.error("[auth] profile load failed (service-role):", error.message);
    } else {
      // Self-healing first login in service-role mode: provision the missing
      // profile from the verified user, defaulting to pending/non-admin.
      const meta = (user.user_metadata ?? {}) as { ign?: string; discord?: string };
      const ign =
        meta.ign && meta.ign.trim().length >= 2 && meta.ign.trim().length <= 32
          ? meta.ign.trim()
          : `player-${user.id.slice(0, 8)}`;
      const { data: created } = await admin
        .from("profiles")
        .upsert(
          {
            id: user.id,
            ign,
            discord: meta.discord?.trim() || null,
            status: "pending",
            is_platform_admin: false,
          },
          { onConflict: "id", ignoreDuplicates: true }
        )
        .select("id, ign, discord, status, is_platform_admin, created_at, last_login_at")
        .maybeSingle();
      if (created) {
        profile = {
          id: created.id,
          ign: created.ign,
          discord: created.discord ?? null,
          status: created.status as AccountStatus,
          isPlatformAdmin: Boolean(created.is_platform_admin),
          createdAt: created.created_at,
          lastLoginAt: created.last_login_at ?? null,
        };
      }
    }
  } else {
    // Anon-key mode: read the caller's own profile row through RLS.
    const { data: row, error: rowError } = await supabase
      .from("profiles")
      .select("id, ign, discord, status, is_platform_admin, created_at, last_login_at")
      .eq("id", user.id)
      .maybeSingle();
    if (row) {
      profile = {
        id: row.id,
        ign: row.ign,
        discord: row.discord ?? null,
        status: row.status as AccountStatus,
        isPlatformAdmin: Boolean(row.is_platform_admin),
        createdAt: row.created_at,
        lastLoginAt: row.last_login_at ?? null,
      };
    } else if (rowError) {
      // DATABASE/RLS failure — must never be interpreted as "pending".
      console.error("[auth] profile load failed (anon-key):", rowError.message);
    } else {
      // Self-healing first login: authentication succeeded but the profile
      // row does not exist yet (signup-trigger race/failure). The definer RPC
      // provisions it from the verified JWT identity — never from client
      // data — and reports the authoritative status/admin flags back.
      const { data: ensured } = await supabase.rpc("ensure_profile");
      if (ensured && ensured.ok) {
        const { data: created } = await supabase
          .from("profiles")
          .select("id, ign, discord, status, is_platform_admin, created_at, last_login_at")
          .eq("id", user.id)
          .maybeSingle();
        if (created) {
          profile = {
            id: created.id,
            ign: created.ign,
            discord: created.discord ?? null,
            status: created.status as AccountStatus,
            isPlatformAdmin: Boolean(created.is_platform_admin),
            createdAt: created.created_at,
            lastLoginAt: created.last_login_at ?? null,
          };
        }
      }
    }
  }

  // Authoritative admin check from inside the database (definer function
  // reading profiles). Belt-and-braces with the profile row above.
  if (!hasServiceRole()) {
    const { data: flag } = await supabase.rpc("is_platform_admin");
    isPlatformAdmin = flag === true || (profile?.isPlatformAdmin ?? false);
  } else {
    isPlatformAdmin = profile?.isPlatformAdmin ?? false;
  }

  // First-admin self-heal: for databases whose earliest account registered
  // before the first-admin rule existed (stuck at pending/non-admin), the
  // caller is promoted — but only if it truly is the earliest profile and
  // no administrator exists. Evaluated inside the DB under the same advisory
  // lock as the signup trigger; a no-op for everyone else. Fires on session
  // resolution (not just login) so it also repairs direct-URL visits and
  // refreshes, and keeps service-role and anon-key modes consistent.
  if (profile && !profile.isPlatformAdmin) {
    try {
      const { data: claim } = hasServiceRole()
        ? await createAdminClient().rpc("claim_first_admin")
        : await supabase.rpc("claim_first_admin");
      if (claim?.promoted) {
        profile = { ...profile, status: claim.status as AccountStatus, isPlatformAdmin: true };
        isPlatformAdmin = true;
      }
    } catch (claimError) {
      console.error("[auth] claim_first_admin failed:", claimError);
    }
  }

  return {
    userId: user.id,
    email: user.email ?? "",
    profile,
    isApproved: profile?.status === "approved",
    isPlatformAdmin,
  };
});

export async function requireSession(): Promise<SessionContext> {
  const ctx = await getSessionContext();
  if (!ctx) throw new AuthError("UNAUTHENTICATED");
  return ctx;
}

export async function requireApproved(): Promise<SessionContext> {
  const ctx = await requireSession();
  if (!ctx.isApproved) throw new AuthError("NOT_APPROVED", ctx.profile?.status);
  return ctx;
}

export async function requireAdmin(): Promise<SessionContext> {
  const ctx = await requireApproved();
  if (!ctx.isPlatformAdmin) throw new AuthError("FORBIDDEN");
  return ctx;
}

export class AuthError extends Error {
  code: string;
  status?: string;
  constructor(code: string, status?: string) {
    super(code);
    this.code = code;
    this.status = status;
  }
}

export function authErrorResponse(error: unknown): Response {
  if (error instanceof AuthError) {
    const messages: Record<string, string> = {
      UNAUTHENTICATED: "You must be signed in to do that.",
      NOT_APPROVED: "Your account is not approved yet.",
      SUSPENDED: "Your account has been suspended.",
      FORBIDDEN: "You do not have permission to do that.",
    };
    const code =
      error.code === "NOT_APPROVED" && error.status === "suspended" ? "SUSPENDED" : error.code;
    return Response.json({ error: messages[code] ?? error.code }, { status: code === "UNAUTHENTICATED" ? 401 : 403 });
  }
  console.error("[auth] unexpected error", error);
  return Response.json({ error: "Something went wrong. Please try again." }, { status: 500 });
}

export type { TeamRole } from "./roles";
export { TEAM_ROLES, isTeamRole } from "./roles";
