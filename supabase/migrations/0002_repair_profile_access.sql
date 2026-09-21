-- ============================================================================
-- 0002 — REPAIR: profile access authorization
--        (fixes 42501 "permission denied for table profiles" during auth)
--
-- Diagnosis (root-caused from 0001_init.sql; verified below by simulation):
--   * A 42501 on SELECT can ONLY come from a missing TABLE GRANT. RLS with
--     no matching policy silently returns zero rows — it never raises.
--     => `authenticated` lost its SELECT grant on public.profiles
--        (grant drift: partially applied migration, manual revoke, or the
--        table being recreated without re-granting).
--   * A 42501 can ALSO occur DURING POLICY EVALUATION when a policy calls a
--     function the calling role cannot EXECUTE. 0001 never granted EXECUTE
--     on public.is_platform_admin() explicitly — it relies on Postgres's
--     default PUBLIC execute, which a hardened project may have revoked.
--     => any profile read then fails with 42501 even with correct grants.
--
-- The repair restores the MINIMUM correct grants and re-asserts the exact
-- policies. Nothing is weakened: RLS stays ON, no USING (true), anon gets
-- nothing, service_role keeps full access. Every statement is idempotent
-- (safe to re-run) and mirrors the intended 0001 end-state.
--
-- NOTE: in Supabase-hosted projects, roles are named `anon`, `authenticated`,
-- `service_role` — exactly the names used below.
-- ============================================================================

-- ----------------------------------------------------------------------------
-- 1. GRANTS on public.profiles (minimum required, nothing excessive)
-- ----------------------------------------------------------------------------
-- anon: NO table access at all (registration/profile creation happens via the
--       security-definer trigger; the check_ign_available RPC is the only
--       pre-auth helper and it is granted separately).
revoke all on public.profiles from anon;

-- authenticated: SELECT (read own/teammates rows under RLS) + UPDATE on the
-- two non-security columns only. No INSERT/DELETE/TRUNCATE/REFERENCES.
grant select on public.profiles to authenticated;
grant update (ign, discord) on public.profiles to authenticated;

-- Explicitly deny destructive/escalation paths even if drift re-added them.
revoke insert, delete, truncate, references, trigger on public.profiles from authenticated;

-- service_role (server-side trusted context only — NEVER exposed to the
-- frontend): full access, as Supabase intends.
grant select, insert, update, delete on public.profiles to service_role;

-- ----------------------------------------------------------------------------
-- 2. EXECUTE grants for every function used INSIDE policies / by the app
--    (a missing EXECUTE is the second classic source of 42501 on reads:
--    the error surfaces while the policy predicate is being evaluated).
-- ----------------------------------------------------------------------------
grant execute on function public.is_platform_admin()      to anon, authenticated;
grant execute on function public.is_team_member(uuid)     to anon, authenticated;
grant execute on function public.is_team_editable(uuid)   to anon, authenticated;
grant execute on function public.shares_team_with_me(uuid) to anon, authenticated;
grant execute on function public.audit_actor()            to service_role;
grant execute on function public.check_ign_available(text) to anon, authenticated;

-- The app calls these RPCs from the authenticated session right after sign-in
-- (self-heal profile provisioning / first-admin repair).
grant execute on function public.ensure_profile() to authenticated;
grant execute on function public.touch_login() to authenticated;
grant execute on function public.claim_first_admin() to authenticated, service_role;
grant execute on function public.log_audit(text, uuid, uuid, jsonb) to authenticated;
grant execute on function public.notify_user(uuid, text, text, text, text) to authenticated, service_role;
grant execute on function public.recent_own_activity(int) to authenticated;
grant execute on function public.update_member_field(uuid, text, text) to authenticated;
grant execute on function public.revert_member_field(uuid, text, text) to authenticated;
grant execute on function public.admin_action(text, uuid, uuid, uuid, jsonb, uuid) to authenticated, service_role;

-- ----------------------------------------------------------------------------
-- 3. RLS: assert enabled (never disabled as a "fix") and re-assert policies
--    exactly as 0001 intended — idempotent drops + creates.
-- ----------------------------------------------------------------------------
alter table public.profiles enable row level security;

-- Read: own row OR platform admin OR teammates (IGNs on the sheet).
-- All cross-table checks go through the security-definer helpers above,
-- which evaluate as the owner and therefore cannot recurse (42P17-safe).
drop policy if exists "profiles: read own, admins or teammates" on public.profiles;
create policy "profiles: read own, admins or teammates"
  on public.profiles for select
  to authenticated, service_role
  using (
    id = auth.uid()
    or public.is_platform_admin()
    or public.shares_team_with_me(id)
  );

-- Insert: only your own row, and only as a plain pending, non-admin profile.
drop policy if exists "profiles: insert own pending" on public.profiles;
create policy "profiles: insert own pending"
  on public.profiles for insert
  to authenticated
  with check (
    id = auth.uid()
    and is_platform_admin = false
    and status = 'pending'
  );

-- Update: own row or admins; the column grant above plus the
-- handle_profile_update trigger block status/admin-flag escalation.
drop policy if exists "profiles: update own or admin" on public.profiles;
create policy "profiles: update own or admin"
  on public.profiles for update
  to authenticated, service_role
  using (id = auth.uid() or public.is_platform_admin())
  with check (id = auth.uid() or public.is_platform_admin());

-- No DELETE policy: profiles are never deleted through the client API.
-- service_role bypasses RLS entirely (table owner / trusted server context).

-- ----------------------------------------------------------------------------
-- 4. Same hygiene for the other tables RLS protects (grants drifted the same
--    way in affected projects; this block makes the whole app consistent).
-- ----------------------------------------------------------------------------
revoke all on public.teams         from anon;
revoke all on public.team_members  from anon;
revoke all on public.notifications from anon;
revoke all on public.audit_logs    from anon;

grant select on public.teams         to authenticated;
grant select on public.team_members  to authenticated;
grant update (role, weapon, availability, notes) on public.team_members to authenticated;
grant select on public.notifications to authenticated;
grant update (read) on public.notifications to authenticated;
grant select on public.audit_logs    to authenticated;

alter table public.teams         enable row level security;
alter table public.team_members  enable row level security;
alter table public.notifications enable row level security;
alter table public.audit_logs    enable row level security;

-- ============================================================================
-- VERIFICATION QUERIES (run in Supabase SQL Editor after applying; the
-- frontend-equivalent simulation is tests/db-sim.test.ts + section 6 below)
-- ============================================================================
-- grants:   select grantee, privilege_type from information_schema.role_table_grants
--           where table_schema='public' and table_name='profiles' order by grantee;
-- rls:      select tablename, rowsecurity from pg_tables
--           where schemaname='public' and tablename='profiles';
-- policies: select policyname, cmd, roles from pg_policies
--           where schemaname='public' and tablename='profiles';
-- simulate the frontend's exact read as the authenticated role:
--   begin; set local role authenticated;
--          set local request.jwt.claims = '{"sub":"<a-real-user-uuid>","role":"authenticated"}';
--          select id, ign, status from public.profiles where id = '<a-real-user-uuid>';
--   rollback;
