import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

/**
 * Regression guards for the 42501 "permission denied for table profiles"
 * repair (supabase/migrations/0002_repair_profile_access.sql). These pin the
 * security-critical grant/RLS end-state: a future edit or a drifted live
 * database can be diffed against this contract in seconds.
 */
const sql = readFileSync(
  join(process.cwd(), "supabase", "migrations", "0002_repair_profile_access.sql"),
  "utf8"
);

describe("0002 repair — grants (the 42501 root cause)", () => {
  it("restores authenticated SELECT on profiles (missing grant = 42501 on reads)", () => {
    expect(sql).toMatch(/grant select on public\.profiles to authenticated/);
  });

  it("keeps anon at zero table access", () => {
    expect(sql).toMatch(/revoke all on public\.profiles from anon/);
    // No anon grant anywhere on profiles.
    expect(sql).not.toMatch(/grant select on public\.profiles to anon/);
  });

  it("limits authenticated UPDATE to non-security columns (ign, discord)", () => {
    expect(sql).toMatch(/grant update \(ign, discord\) on public\.profiles to authenticated/);
    // No full-row update grant for authenticated.
    expect(sql).not.toMatch(/grant update on public\.profiles to authenticated/);
  });

  it("explicitly denies insert/delete on profiles for authenticated", () => {
    expect(sql).toMatch(/revoke insert, delete, truncate, references, trigger on public\.profiles from authenticated/);
  });

  it("service_role keeps full access (server-only, never frontend)", () => {
    expect(sql).toMatch(/grant select, insert, update, delete on public\.profiles to service_role/);
  });

  it("grants EXECUTE on the policy helper functions (second 42501 source)", () => {
    for (const fn of [
      "public.is_platform_admin()",
      "public.is_team_member(uuid)",
      "public.is_team_editable(uuid)",
      "public.shares_team_with_me(uuid)",
    ]) {
      expect(sql).toContain(fn);
    }
    expect(sql).toMatch(/grant execute on function public\.is_platform_admin\(\)\s+to anon, authenticated/);
  });

  it("grants EXECUTE on the post-signin self-heal RPCs used at login", () => {
    expect(sql).toMatch(/grant execute on function public\.ensure_profile\(\) to authenticated/);
    expect(sql).toMatch(/grant execute on function public\.touch_login\(\) to authenticated/);
    expect(sql).toMatch(/grant execute on function public\.claim_first_admin\(\) to authenticated, service_role/);
  });
});

describe("0002 repair — RLS stays ON, policies unchanged in intent", () => {
  it("re-asserts RLS enabled (never disabled as a fix)", () => {
    expect(sql).toMatch(/alter table public\.profiles enable row level security/);
    expect(sql).not.toMatch(/disable row level security/);
  });

  it("read policy: own row OR admin OR teammates — no USING (true), no world-readable profiles", () => {
    expect(sql).toContain('create policy "profiles: read own, admins or teammates"');
    expect(sql).toMatch(/id = auth\.uid\(\)/);
    expect(sql).not.toMatch(/using \(true\)/);
  });

  it("insert policy confines self-registration to pending non-admin rows", () => WITH_CHECK_PENDING());

  function WITH_CHECK_PENDING() {
    expect(sql).toContain('create policy "profiles: insert own pending"');
    expect(sql).toMatch(/is_platform_admin = false/);
    expect(sql).toMatch(/status = 'pending'/);
  }

  it("update policy is scoped to own row or admins", () => {
    expect(sql).toContain('create policy "profiles: update own or admin"');
  });

  it("no DELETE policy for client roles", () => {
    expect(sql).not.toMatch(/for delete\s+to (anon|authenticated)/);
  });

  it("same grant hygiene applied to every RLS-protected table", () => {
    for (const t of ["teams", "team_members", "notifications", "audit_logs"]) {
      expect(sql).toMatch(new RegExp(`revoke all on public\\.${t}\\s+from anon`));
      expect(sql).toMatch(new RegExp(`alter table public\\.${t}\\s+enable row level security`));
    }
  });
});
