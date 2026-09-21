-- ============================================================================
-- 0003 — REPAIR: complete authorization end-state for all protected tables
--        (fixes 42501 "permission denied for table team_members / audit_logs"
--         persisting during real application usage)
--
-- DIAGNOSIS (root-caused, not guessed):
--
--   The application performs exactly ONE operation class on team_members and
--   audit_logs from the client path: SELECT through the `authenticated` role
--   (member teams/dashboard/profile pages, admin dashboard/activity/account
--   pages). Every write to those two tables happens inside security-definer
--   triggers/RPCs (handle_membership_change, log_audit, admin_action), which
--   run as the table owner and cannot hit a client-role grant error.
--
--   A 42501 whose message names a TABLE on a SELECT has exactly one cause:
--   the calling role lost its TABLE-level SELECT grant.
--     * RLS with no matching policy returns ZERO ROWS silently — never 42501.
--     * A missing EXECUTE on a helper used inside a policy names the FUNCTION
--       ("permission denied for function is_platform_admin"), not the table.
--   Therefore the live database is missing
--       grant select on public.team_members  to authenticated;
--       grant select on public.audit_logs    to authenticated;
--   despite 0001 containing them — i.e. GRANT DRIFT: the grants block was
--   never applied (partial SQL-editor paste) or was reset (table recreated
--   via dashboard, platform default-privilege hardening, manual revoke).
--
-- THE FIX: re-assert the COMPLETE end-state — minimum grants per role,
-- EXECUTE on every function used by policies or called by the app, RLS
-- enabled, and the full intended policy set — in one idempotent file that
-- can be pasted into the Supabase SQL Editor in a single run.
--
-- NOTHING IS WEAKENED: RLS stays enabled on every table, anon keeps zero
-- table access, authenticated gets column-scoped UPDATE only where the UI
-- needs it, service_role keeps full server-side access. No USING (true),
-- no DISABLE ROW LEVEL SECURITY, no new permissive policies.
--
-- VERIFY AFTER APPLYING:  npm run db:doctor
--   (simulates the frontend's exact requests as anon/authenticated roles
--    over a real connection — the SQL editor's elevated privileges cannot).
-- ============================================================================

-- ----------------------------------------------------------------------------
-- 1. TABLE GRANTS — the 42501 root cause, restated for all five tables
-- ----------------------------------------------------------------------------
-- anon: zero access to every table (registration is handled by the
--       security-definer signup trigger; pre-auth IGN check is an RPC).
revoke all on public.profiles      from anon;
revoke all on public.teams         from anon;
revoke all on public.team_members  from anon;
revoke all on public.notifications from anon;
revoke all on public.audit_logs    from anon;

-- authenticated: SELECT everywhere the UI reads; UPDATE restricted to the
-- exact non-security columns the UI edits (column-level, never full-row).
grant select on public.profiles      to authenticated;
grant update (ign, discord)          on public.profiles to authenticated;

grant select on public.teams         to authenticated;

grant select on public.team_members  to authenticated;
grant update (role, weapon, availability, notes)
                                     on public.team_members to authenticated;

grant select on public.notifications to authenticated;
grant update (read)                  on public.notifications to authenticated;

grant select on public.audit_logs    to authenticated;   -- ← the 42501 fix

-- Explicit denials: no member-created/destroyed rows anywhere, and never a
-- write to the append-only audit trail through the client role.
revoke insert, update, delete, truncate, references, trigger
  on public.audit_logs    from authenticated;
revoke insert, delete, truncate, references, trigger
  on public.profiles      from authenticated;
revoke insert, delete, truncate, references, trigger
  on public.team_members  from authenticated;
revoke insert, delete, truncate, references, trigger
  on public.notifications from authenticated;
revoke insert, update, delete, truncate, references, trigger
  on public.teams         from authenticated;

-- service_role: trusted server context only (NEVER exposed to the browser).
grant select, insert, update, delete on public.profiles      to service_role;
grant select, insert, update, delete on public.teams         to service_role;
grant select, insert, update, delete on public.team_members  to service_role;
grant select, insert, update, delete on public.notifications to service_role;
grant select, insert, update, delete on public.audit_logs    to service_role;

-- ----------------------------------------------------------------------------
-- 2. EXECUTE GRANTS — the second 42501 source (policy evaluation) and every
--    RPC the application calls from the authenticated session
-- ----------------------------------------------------------------------------
-- Policy helpers (evaluated inside RLS predicates).
grant execute on function public.is_platform_admin()        to anon, authenticated;
grant execute on function public.is_team_member(uuid)       to anon, authenticated;
grant execute on function public.is_team_editable(uuid)     to anon, authenticated;
grant execute on function public.shares_team_with_me(uuid)  to anon, authenticated;

-- Pre-auth registration helper.
grant execute on function public.check_ign_available(text)  to anon, authenticated;

-- Login/session RPCs.
grant execute on function public.ensure_profile()           to authenticated;
grant execute on function public.touch_login()              to authenticated;
grant execute on function public.claim_first_admin()        to authenticated, service_role;

-- Audit + notification RPCs.
grant execute on function public.log_audit(text, uuid, uuid, jsonb)            to authenticated;
grant execute on function public.notify_user(uuid, text, text, text, text)     to authenticated, service_role;
grant execute on function public.audit_actor()                                 to service_role;
grant execute on function public.recent_own_activity(int)                      to authenticated;

-- Sheet + admin RPCs.
grant execute on function public.update_member_field(uuid, text, text)         to authenticated;
grant execute on function public.revert_member_field(uuid, text, text)         to authenticated;
grant execute on function public.admin_action(text, uuid, uuid, uuid, jsonb, uuid)
                                                          to authenticated, service_role;

-- ----------------------------------------------------------------------------
-- 3. RLS — assert ENABLED everywhere (never disabled as a "fix") and
--    re-assert the complete intended policy set (idempotent drops+creates,
--    so drifted or duplicate "policy_fix" accretions are cleaned up).
-- ----------------------------------------------------------------------------
alter table public.profiles      enable row level security;
alter table public.teams         enable row level security;
alter table public.team_members  enable row level security;
alter table public.notifications enable row level security;
alter table public.audit_logs    enable row level security;

-- ---------- profiles ----------
-- Read: own row OR admins OR teammates (sheet needs teammates' IGNs).
-- Cross-table checks go through security-definer helpers → 42P17-safe.
drop policy if exists "profiles: read own, admins or teammates" on public.profiles;
create policy "profiles: read own, admins or teammates"
  on public.profiles for select
  to authenticated, service_role
  using (
    id = auth.uid()
    or public.is_platform_admin()
    or public.shares_team_with_me(id)
  );

-- Insert: only your own row, only as a plain pending non-admin profile.
drop policy if exists "profiles: insert own pending" on public.profiles;
create policy "profiles: insert own pending"
  on public.profiles for insert
  to authenticated
  with check (
    id = auth.uid()
    and is_platform_admin = false
    and status = 'pending'
  );

-- Update: own row or admins; the handle_profile_update trigger independently
-- blocks status/admin-flag changes by non-admins.
drop policy if exists "profiles: update own or admin" on public.profiles;
create policy "profiles: update own or admin"
  on public.profiles for update
  to authenticated, service_role
  using (id = auth.uid() or public.is_platform_admin())
  with check (id = auth.uid() or public.is_platform_admin());

-- No DELETE policy: profiles are never deleted through the client API.

-- ---------- teams ----------
drop policy if exists "teams: members and admins read" on public.teams;
create policy "teams: members and admins read"
  on public.teams for select
  to authenticated, service_role
  using (public.is_platform_admin() or public.is_team_member(id));

drop policy if exists "teams: admins insert" on public.teams;
create policy "teams: admins insert"
  on public.teams for insert
  to authenticated, service_role
  with check (public.is_platform_admin());

drop policy if exists "teams: admins update" on public.teams;
create policy "teams: admins update"
  on public.teams for update
  to authenticated, service_role
  using (public.is_platform_admin())
  with check (public.is_platform_admin());

drop policy if exists "teams: admins delete" on public.teams;
create policy "teams: admins delete"
  on public.teams for delete
  to authenticated, service_role
  using (public.is_platform_admin());
-- Note: no INSERT/UPDATE/DELETE table grant for authenticated (section 1) —
-- privileged team writes flow through the admin_action definer RPC even in
-- anon-key mode. Policy + grant = two independent gates.

-- ---------- team_members ----------
drop policy if exists "team_members: team members and admins read" on public.team_members;
create policy "team_members: team members and admins read"
  on public.team_members for select
  to authenticated, service_role
  using (
    public.is_platform_admin()
    or user_id = auth.uid()
    or public.is_team_member(team_id)
  );

drop policy if exists "team_members: admins insert" on public.team_members;
create policy "team_members: admins insert"
  on public.team_members for insert
  to authenticated, service_role
  with check (public.is_platform_admin());

-- Members may update only their own row, and only while the sheet is
-- editable; the column grant in section 1 restricts which fields, and the
-- update_member_field RPC re-validates ownership/lock/status atomically.
drop policy if exists "team_members: own row update on editable sheets" on public.team_members;
create policy "team_members: own row update on editable sheets"
  on public.team_members for update
  to authenticated, service_role
  using (
    public.is_platform_admin()
    or (user_id = auth.uid() and public.is_team_editable(team_id))
  )
  with check (
    public.is_platform_admin()
    or (user_id = auth.uid() and public.is_team_editable(team_id))
  );

drop policy if exists "team_members: admins delete" on public.team_members;
create policy "team_members: admins delete"
  on public.team_members for delete
  to authenticated, service_role
  using (public.is_platform_admin());

-- ---------- notifications ----------
drop policy if exists "notifications: read own" on public.notifications;
create policy "notifications: read own"
  on public.notifications for select
  to authenticated, service_role
  using (user_id = auth.uid());

drop policy if exists "notifications: update own" on public.notifications;
create policy "notifications: update own"
  on public.notifications for update
  to authenticated, service_role
  using (user_id = auth.uid())
  with check (user_id = auth.uid());

-- ---------- audit_logs ----------
-- Append-only; admin-readable. Members read their own events through the
-- recent_own_activity() definer RPC, never through this table.
drop policy if exists "audit_logs: admins read" on public.audit_logs;
create policy "audit_logs: admins read"
  on public.audit_logs for select
  to authenticated, service_role
  using (public.is_platform_admin());

-- No INSERT/UPDATE/DELETE policies anywhere: audit writes happen via
-- triggers, security-definer RPCs, or the server-side service-role client.

-- ============================================================================
-- VERIFICATION QUERIES (manual option) — or just run:  npm run db:doctor
-- ============================================================================
-- RLS:        select tablename, rowsecurity from pg_tables
--             where schemaname='public'
--               and tablename in ('profiles','teams','team_members','notifications','audit_logs');
-- Grants:     select table_name, grantee, privilege_type
--             from information_schema.role_table_grants
--             where table_schema='public'
--               and table_name in ('team_members','audit_logs')
--             order by table_name, grantee, privilege_type;
-- Policies:   select tablename, policyname, cmd, roles from pg_policies
--             where schemaname='public' order by tablename, policyname;
-- Frontend-equivalent probe (the SQL editor runs elevated — do not trust it
-- alone; simulate the real client role):
--   begin;
--     set local role authenticated;
--     set local request.jwt.claims = '{"sub":"<a-real-user-uuid>","role":"authenticated"}';
--     select count(*) from public.team_members;   -- must NOT raise 42501
--     select count(*) from public.audit_logs;     -- must NOT raise 42501
--   rollback;
