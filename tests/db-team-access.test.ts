import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

/**
 * Regression guards for the persistent 42501 errors on team_members and
 * audit_logs (supabase/migrations/0003_repair_team_access.sql).
 *
 * The mechanical facts these tests encode:
 *   * A 42501 naming a TABLE on SELECT = missing table-level grant.
 *     (RLS with no matching policy returns zero rows, never an error.)
 *   * The app reads team_members/audit_logs ONLY via SELECT through the
 *     `authenticated` role; writes go through definer triggers/RPCs.
 *   * 0001 contained the correct grants — the live DB had drifted. 0003
 *     re-asserts the complete end-state idempotently.
 */
const sql = readFileSync(
  join(process.cwd(), "supabase", "migrations", "0003_repair_team_access.sql"),
  "utf8"
);

const TABLES = ["profiles", "teams", "team_members", "notifications", "audit_logs"];

describe("0003 repair — grants (the 42501 root cause)", () => {
  it("restores authenticated SELECT on the two failing tables", () => {
    for (const t of ["team_members", "audit_logs"]) {
      expect(sql).toMatch(new RegExp(`grant select on public\\.${t}\\s+to authenticated`));
    }
  });

  it("restores authenticated SELECT on every protected table", () => {
    for (const t of TABLES) {
      expect(sql).toMatch(new RegExp(`grant select on public\\.${t}\\s+to authenticated`));
    }
  });

  it("keeps anon at zero table access (revoke all, no grants)", () => {
    for (const t of TABLES) {
      expect(sql).toMatch(new RegExp(`revoke all on public\\.${t}\\s+from anon`));
      expect(sql, `${t} must not be granted to anon`).not.toMatch(
        new RegExp(`grant (select|insert|update|delete) on public\\.${t}\\s+to anon`)
      );
    }
  });

  it("authenticated UPDATE on team_members is column-scoped to sheet fields only", () => {
    expect(sql).toMatch(/grant update \(role, weapon, availability, notes\)\s+on public\.team_members to authenticated/);
    // No full-row update grant.
    expect(sql).not.toMatch(/grant update on public\.team_members to authenticated/);
    // No grant on the security-relevant columns.
    expect(sql).not.toMatch(/grant update \([^)]*added_by/);
    expect(sql).not.toMatch(/grant update \([^)]*user_id/);
  });

  it("audit_logs stays append-only for the client role", () => {
    expect(sql).toMatch(
      /revoke insert, update, delete, truncate, references, trigger\s+on public\.audit_logs\s+from authenticated/
    );
    // And no write policy for client roles exists in 0003.
    const block = sql.slice(sql.indexOf("-- ---------- audit_logs ----------"));
    expect(block).not.toMatch(/for insert|for update|for delete/);
  });

  it("service_role retains full access to every table", () => {
    for (const t of TABLES) {
      expect(sql).toMatch(
        new RegExp(`grant select, insert, update, delete on public\\.${t}\\s+to service_role`)
      );
    }
  });
});

describe("0003 repair — EXECUTE grants (second 42501 source)", () => {
  it("grants EXECUTE on every policy helper to the roles policies run as", () => {
    for (const fn of [
      "public.is_platform_admin()",
      "public.is_team_member(uuid)",
      "public.is_team_editable(uuid)",
      "public.shares_team_with_me(uuid)",
    ]) {
      expect(sql).toContain(fn);
    }
    expect(sql).toMatch(/grant execute on function public\.is_platform_admin\(\)\s+to anon, authenticated/);
    expect(sql).toMatch(/grant execute on function public\.is_team_member\(uuid\)\s+to anon, authenticated/);
  });

  it("grants EXECUTE on every RPC the app calls from the session", () => {
    for (const re of [
      /grant execute on function public\.ensure_profile\(\)\s+to authenticated/,
      /grant execute on function public\.touch_login\(\)\s+to authenticated/,
      /grant execute on function public\.log_audit\(text, uuid, uuid, jsonb\)\s+to authenticated/,
      /grant execute on function public\.recent_own_activity\(int\)\s+to authenticated/,
      /grant execute on function public\.update_member_field\(uuid, text, text\)\s+to authenticated/,
      /grant execute on function public\.revert_member_field\(uuid, text, text\)\s+to authenticated/,
      /grant execute on function public\.admin_action\(text, uuid, uuid, uuid, jsonb, uuid\)/,
    ]) {
      expect(sql).toMatch(re);
    }
  });
});

describe("0003 repair — RLS stays enabled, policies complete", () => {
  it("enables RLS on every table and never disables it", () => {
    for (const t of TABLES) {
      expect(sql).toMatch(new RegExp(`alter table public\\.${t}\\s+enable row level security`));
    }
    expect(sql).not.toMatch(/disable row level security/);
  });

  it("team_members SELECT policy: own rows + own teams + admins (no self-query)", () => {
    const block = sql.slice(sql.indexOf("-- ---------- team_members ----------"), sql.indexOf("-- ---------- notifications"));
    expect(block).toContain('create policy "team_members: team members and admins read"');
    expect(block).toContain("user_id = auth.uid()");
    expect(block).toContain("public.is_team_member(team_id)");
    expect(block).not.toMatch(/from\s+public\.team_members/);
  });

  it("team_members INSERT/UPDATE/DELETE policies are separated and admin/own-scoped", () => {
    const block = sql.slice(sql.indexOf("-- ---------- team_members ----------"), sql.indexOf("-- ---------- notifications"));
    expect(block).toMatch(/for insert\s+to authenticated, service_role\s+with check \(public\.is_platform_admin\(\)\)/);
    expect(block).toMatch(/for update[\s\S]*user_id = auth\.uid\(\) and public\.is_team_editable\(team_id\)/);
    expect(block).toMatch(/for delete\s+to authenticated, service_role\s+using \(public\.is_platform_admin\(\)\)/);
  });

  it("audit_logs SELECT policy is admin-only — members use recent_own_activity()", () => {
    const block = sql.slice(sql.indexOf("-- ---------- audit_logs ----------"));
    expect(block).toContain('create policy "audit_logs: admins read"');
    expect(block).toContain("public.is_platform_admin()");
    expect(block).not.toMatch(/target_user_id = auth\.uid\(\)/);
  });

  it("no policy queries its own table (42P17 recursion guard)", () => {
    // Check only the actual policy expressions (pg_policies qual/with_check
    // equivalents), not migration comments.
    const policyExprs = [...sql.matchAll(/using\s*\(([\s\S]*?)\);/g)].map((m) => m[1]);
    expect(policyExprs.length).toBeGreaterThan(0);
    for (const t of TABLES) {
      for (const expr of policyExprs) {
        expect(expr, `policy expression must not select from public.${t}`).not.toMatch(
          new RegExp(`from\\s+public\\.${t}\\b`)
        );
      }
    }
  });

  it("policies name explicit roles (no accidental anon coverage)", () => {
    const policyCount = (sql.match(/create policy/g) ?? []).length;
    const toRoleCount = (sql.match(/to authenticated, service_role|to authenticated\b/g) ?? []).length;
    expect(toRoleCount).toBeGreaterThanOrEqual(policyCount);
    expect(sql).not.toMatch(/create policy[\s\S]{0,200}to anon(?!, service_role)/);
  });

  it("no USING (true) anywhere", () => {
    expect(sql).not.toMatch(/using\s*\(\s*true\s*\)/);
  });
});

describe("0003 repair — operational tooling", () => {
  it("db:doctor exists and simulates the frontend roles", () => {
    const doctor = readFileSync(join(process.cwd(), "scripts", "db-doctor.mjs"), "utf8");
    expect(doctor).toContain("set local role authenticated");
    expect(doctor).toContain("set local role anon");
    expect(doctor).toContain("audit_logs");
    expect(doctor).toContain("team_members");
    // Probes must roll back — never mutate a live database.
    expect(doctor).toContain("rollback");
  });

  it("db-push records applied migrations (drift becomes visible)", () => {
    const push = readFileSync(join(process.cwd(), "scripts", "db-push.mjs"), "utf8");
    expect(push).toContain("schema_migrations");
  });
});
