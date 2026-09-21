import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

/**
 * Static consistency checks over supabase/migrations/0002_auth_profile_layer.sql.
 *
 * Encoded facts (each one corresponds to a real production error this migration
 * fixes — the guards prevent regression):
 *
 *   * ensure_profile / touch_login / check_ign_available / claim_first_admin
 *     are called by the login, register and verify-email pages; when 0001
 *     dropped them PostgREST returned 404 "Could not find the function …
 *     in the schema cache" and the UI misread the failure as a broken session.
 *
 *   * profiles.last_login_at / approved_at / suspended_at are selected by five
 *     UI files and written by admin_user_action(); their absence produced 42703
 *     "column profiles.last_login_at does not exist" on every profile load —
 *     which is why the admin dashboard became unreachable.
 *
 *   * claim_first_admin must be identity-safe: auth.uid() only, advisory-locked,
 *     no `USING (true)` shortcuts anywhere.
 */
const sql = readFileSync(
  join(process.cwd(), "supabase", "migrations", "0002_auth_profile_layer.sql"),
  "utf8",
);

describe("0002 — missing auth/profile objects are defined", () => {
  it("defines ensure_profile() with the zero-argument signature the app calls", () => {
    expect(sql).toMatch(/create or replace function public\.ensure_profile\(\)/);
  });

  it("defines touch_login(), check_ign_available(text) and claim_first_admin()", () => {
    expect(sql).toMatch(/create or replace function public\.touch_login\(\)/);
    expect(sql).toMatch(/create or replace function public\.check_ign_available\(p_ign text\)/);
    expect(sql).toMatch(/create or replace function public\.claim_first_admin\(\)/);
  });

  it("adds the three profile timestamp columns (last_login_at, approved_at, suspended_at)", () => {
    for (const c of ["last_login_at", "approved_at", "suspended_at"]) {
      expect(sql).toMatch(new RegExp(`add column if not exists ${c}\\s+timestamptz`));
    }
  });
});

describe("0002 — security posture", () => {
  it("every function is security definer with a pinned search_path", () => {
    const defs = sql.split(/(?=create or replace function)/);
    const fns = defs.filter((d) => d.startsWith("create or replace function"));
    expect(fns.length).toBeGreaterThanOrEqual(4);
    for (const f of fns) {
      expect(f).toMatch(/security definer/);
      expect(f).toMatch(/set search_path = public/);
    }
  });

  it("never grants execute to public; anon only where the contract requires it", () => {
    // The only anon grant in the file is the registration-page IGN check.
    const grants = sql.match(/grant execute on function public\.\w+[^;]+;/g) ?? [];
    expect(grants.length).toBe(4);
    const anonGrants = grants.filter((g) => g.includes(" to anon"));
    expect(anonGrants.length).toBe(1);
    expect(anonGrants[0]).toMatch(/check_ign_available\(text\)/);
    // And every function is explicitly revoked from public first.
    expect((sql.match(/revoke all on function/g) ?? []).length).toBe(4);
  });

  it("claim_first_admin promotes only via auth.uid() under an advisory lock", () => {
    const body = sql.split("create or replace function public.claim_first_admin")[1] ?? "";
    expect(body).toMatch(/auth\.uid\(\) is null/);
    expect(body).toMatch(/pg_advisory_xact_lock/);
    // Promotion path updates the caller's own row and audits the change.
    expect(body).toMatch(/where id = auth\.uid\(\)/);
    expect(body).toMatch(/'PERMISSION_CHANGED'/);
  });

  it("profile-update trigger blocks non-admin status/self-promotion writes", () => {
    const body = sql.split("create or replace function public.handle_profile_update")[1] ?? "";
    expect(body).toMatch(/Only administrators can change account status or admin flag/);
    expect(body).toMatch(/USER_LOGIN/);
  });

  it("no policy in this migration uses USING (true)/WITH CHECK (true) shortcuts", () => {
    expect(sql).not.toMatch(/using \(true\)/i);
    expect(sql).not.toMatch(/with check \(true\)/i);
  });

  it("registers notifications for realtime updates", () => {
    expect(sql).toMatch(/alter publication supabase_realtime add table public\.notifications/);
  });
});

describe("0002 — reset script consistency", () => {
  it("reset.sql drops every object this migration creates", () => {
    const reset = readFileSync(join(process.cwd(), "supabase", "reset.sql"), "utf8");
    expect(reset).toMatch(/drop function if exists public\.ensure_profile\(\);/);
    expect(reset).toMatch(/drop function if exists public\.touch_login\(\);/);
    expect(reset).toMatch(/drop function if exists public\.check_ign_available\(text\);/);
    expect(reset).toMatch(/drop function if exists public\.claim_first_admin\(\);/);
    expect(reset).toMatch(/drop function if exists public\.handle_profile_update\(\);/);
  });
});
