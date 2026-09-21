import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

/**
 * Static consistency checks over the SQL migration. These guard the
 * security-critical invariants whose violation caused the 42P17 recursion
 * and the 42501 permission errors, so a future edit cannot silently
 * reintroduce them. (Full behavioral RLS testing requires a live Postgres —
 * see README "Testing".)
 */
const sql = readFileSync(join(process.cwd(), "supabase", "migrations", "0001_init.sql"), "utf8");
const bootstrap = readFileSync(join(process.cwd(), "supabase", "bootstrap-admin.sql"), "utf8");

const tables = ["profiles", "teams", "team_members", "notifications", "audit_logs"];

function policyBlock(table: string): string {
  // From the table's RLS section to the next table marker (or end).
  const start = sql.indexOf(`-- ---------- ${table} ----------`);
  const nextMarker = sql.slice(start + 1).indexOf("\n-- ---------- ");
  return start === -1
    ? ""
    : sql.slice(start, nextMarker === -1 ? undefined : start + 1 + nextMarker);
}

describe("RLS architecture (42P17 / 42501 regression guards)", () => {
  it("enables RLS on every table", () => {
    for (const t of tables) {
      expect(sql).toMatch(new RegExp(`alter table public\\.${t} enable row level security`));
    }
  });

  it("defines the definer helper functions used by policies", () => {
    for (const fn of [
      "create or replace function public.is_platform_admin()",
      "create or replace function public.is_team_member(p_team_id uuid)",
      "create or replace function public.is_team_editable(p_team_id uuid)",
      "create or replace function public.shares_team_with_me(p_other_user uuid)",
    ]) {
      expect(sql).toContain(fn);
    }
  });

  it("helpers are security definer (evaluate as owner → no policy recursion)", () => {
    const helpers = ["is_platform_admin", "is_team_member", "is_team_editable", "shares_team_with_me"];
    for (const h of helpers) {
      const idx = sql.indexOf(`function public.${h}(`);
      const body = sql.slice(idx, idx + 400);
      expect(body, `${h} must be security definer`).toContain("security definer");
    }
  });

  it("no policy queries its own table directly (the 42P17 root cause)", () => {
    for (const t of tables) {
      const block = policyBlock(t);
      expect(block, `policy block for ${t} should exist`).not.toBe("");
      // A direct `from public.<t>` or `update/delete on <t>` reference inside
      // the same table's policy block is the recursion signature. Helpers
      // (security definer) are the sanctioned replacement.
      expect(block, `${t} policy must not select from itself`).not.toMatch(
        new RegExp(`from\\s+public\\.${t}\\b`)
      );
    }
  });

  it("team_members select policy uses the definer helper, not a self-query", () => {
    const block = policyBlock("team_members");
    expect(block).toContain("create policy \"team_members: team members and admins read\"");
    expect(block).toContain("public.is_team_member(team_id)");
  });

  it("teams select policy delegates membership to the helper", () => {
    const block = policyBlock("teams");
    expect(block).toContain("public.is_team_member(id)");
  });

  it("profiles are not world-readable: anon has no grants, visibility is scoped", () => {
    const grants = sql.slice(sql.indexOf("-- GRANTS: tighten default privileges"));
    expect(grants).toMatch(/revoke all on public\.profiles from anon/);
    expect(grants).not.toMatch(/grant select on public\.profiles to anon/);
    const block = policyBlock("profiles");
    expect(block).toContain("id = auth.uid()");
    expect(block).toContain("public.shares_team_with_me(id)");
  });

  it("audit_logs are readable by admins only — no member reads", () => {
    const block = policyBlock("audit_logs");
    expect(block).toContain('create policy "audit_logs: admins read"');
    expect(block).toContain("public.is_platform_admin()");
    expect(block).not.toMatch(/target_user_id = auth\.uid\(\)/); // members must use the RPC
  });

  it("notifications are scoped to their owner", () => {
    const block = policyBlock("notifications");
    expect(block).toContain("user_id = auth.uid()");
  });

  it("insert/update/delete policies are separated per operation on team_members", () => {
    const block = policyBlock("team_members");
    expect(block).toMatch(/for insert/i);
    expect(block).toMatch(/for update/i);
    expect(block).toMatch(/for delete/i);
    expect(block).toMatch(/for select/i);
  });

  it("protected tables have no client insert/update/delete policies", () => {
    expect(policyBlock("audit_logs")).not.toMatch(/for insert|for update|for delete/i);
    expect(policyBlock("notifications")).not.toMatch(/for insert/i);
  });
});

describe("Privileged RPC hardening", () => {
  it("admin_action re-verifies admin inside the function and supports trusted-server attribution", () => {
    expect(sql).toContain("p_actor_id uuid default null");
    expect(sql).toMatch(/if not v_is_admin then\s*\n\s*return jsonb_build_object\('ok', false, 'error', 'FORBIDDEN'\)/);
  });

  it("log_audit rejects actions the database records automatically", () => {
    const idx = sql.indexOf("function public.log_audit(");
    const body = sql.slice(idx, sql.indexOf("$$;", idx));
    expect(body).toContain("raise exception");
    expect(body).toContain("'USER_LOGOUT'");
  });

  it("notify_user cannot be abused by regular members to spoof notifications", () => {
    const idx = sql.indexOf("function public.notify_user(");
    const body = sql.slice(idx, idx + 700);
    expect(body).toContain("raise exception 'FORBIDDEN'");
  });

  it("ensure_profile never grants admin and derives identity from the JWT", () => {
    const idx = sql.indexOf("function public.ensure_profile()");
    const body = sql.slice(idx, sql.indexOf("$$;", idx));
    expect(body).toContain("auth.uid() is null");
    expect(body).toContain("'pending', false");
  });

  it("recent_own_activity scopes rows to the caller", () => {
    const idx = sql.indexOf("function public.recent_own_activity(");
    const body = sql.slice(idx, sql.indexOf("$$;", idx));
    expect(body).toContain("a.actor_id = auth.uid() or a.target_user_id = auth.uid()");
  });

  it("touch_login only updates the caller's own row", () => {
    const idx = sql.indexOf("function public.touch_login()");
    const body = sql.slice(idx, sql.indexOf("$$;", idx));
    expect(body).toContain("where id = auth.uid()");
  });

  it("field updates validate ownership, approval, lock and team status in-DB", () => {
    const idx = sql.indexOf("function public.update_member_field(");
    const body = sql.slice(idx, sql.indexOf("$$;", idx));
    for (const marker of [
      "ACCOUNT_NOT_APPROVED",
      "FORBIDDEN",
      "SHEET_LOCKED",
      "TEAM_NOT_EDITABLE",
      "INVALID_FIELD",
      "INVALID_VALUE",
    ]) {
      expect(body).toContain(marker);
    }
  });
});

describe("Account lifecycle & bootstrap", () => {
  it("signup no longer auto-grants admin to the first account", () => {
    const idx = sql.indexOf("function public.handle_new_user()");
    const body = sql.slice(idx, sql.indexOf("$$;", idx));
    expect(body).not.toContain("profile_count");
    expect(body).toMatch(/'pending', false/);
  });

  it("the one-time bootstrap script promotes an existing registered account", () => {
    expect(bootstrap).toContain("is_platform_admin = true");
    expect(bootstrap).toContain("status = 'approved'");
    expect(bootstrap).toMatch(/PERMISSION_CHANGED/);
    expect(bootstrap).toContain("auth.users");
  });

  it("profile updates cannot change status/admin flag without admin rights", () => {
    const idx = sql.indexOf("function public.handle_profile_update()");
    const body = sql.slice(idx, sql.indexOf("$$;", idx));
    expect(body).toContain("Only administrators can change account status");
  });

  it("IGN uniqueness is enforced by the database", () => {
    expect(sql).toContain("profiles_ign_unique_idx");
    expect(sql).toContain("unique index");
  });
});

describe("Audit trigger coverage", () => {
  it("records every operation the platform promises to audit", () => {
    const required = [
      "USER_REGISTERED",
      "USER_APPROVED",
      "USER_REJECTED",
      "USER_SUSPENDED",
      "USER_REACTIVATED",
      "USER_ARCHIVED",
      "USER_LOGIN",
      "USER_LOGOUT",
      "TEAM_CREATED", // written by the API route via log_audit/admin insert
      "TEAM_RENAMED",
      "TEAM_ARCHIVED",
      "MEMBER_ADDED",
      "MEMBER_REMOVED",
      "SHEET_LOCKED",
      "SHEET_UNLOCKED",
      "FIELD_UPDATED",
      "CHANGE_REVERTED",
      "PERMISSION_CHANGED",
    ];
    for (const action of required) {
      expect(sql, `missing audit action ${action}`).toContain(`'${action}'`);
    }
  });

  it("team and membership triggers exist for insert/update/delete paths", () => {
    expect(sql).toMatch(/create trigger on_team_change/);
    expect(sql).toMatch(/create trigger on_membership_insert/);
    expect(sql).toMatch(/create trigger on_membership_delete/);
    expect(sql).toMatch(/create trigger on_member_field_change/);
    expect(sql).toMatch(/create trigger on_auth_user_created/);
  });
});
