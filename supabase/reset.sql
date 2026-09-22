-- ============================================================================
-- supabase/reset.sql — DEVELOPMENT RESET (DESTRUCTIVE)
--
-- Removes the ENTIRE application schema (new + legacy) so `npm run db:push`
-- recreates a clean database from supabase/migrations/ (0001 + 0002).
--
-- ⚠️  NEVER run against production. ⚠️
-- ⚠️  auth.users is INTENTIONALLY PRESERVED — Supabase Auth infrastructure
--     (users, sessions, identities) is never touched. Profiles are dropped
--     and recreated by the on_auth_user_created trigger only for users who
--     register AFTER the reset; existing auth users will have no profile
--     until they trigger signup sync or an admin inserts one. On local dev
--     projects it is usually cleanest to also delete test users from
--     Supabase Dashboard → Authentication manually if desired.
--
-- Idempotent: every statement uses IF EXISTS. Safe to re-run.
-- ============================================================================

-- 1. New application tables -------------------------------------------------
drop table if exists public.event_signups cascade;
drop table if exists public.event_slot_requirements cascade;
drop table if exists public.event_slots cascade;
drop table if exists public.event_parties cascade;
drop table if exists public.events cascade;

drop table if exists public.albion_equipment cascade;
drop table if exists public.notifications cascade;
drop table if exists public.audit_logs cascade;
drop table if exists public.profiles cascade;

-- 2. Legacy Team-system tables (in case this dev DB ran the old schema) -----
drop table if exists public.mass_assignments cascade;
drop table if exists public.mass_slots cascade;
drop table if exists public.mass_parties cascade;
drop table if exists public.mass_sheets cascade;
drop table if exists public.team_members cascade;
drop table if exists public.teams cascade;
drop table if exists public.sheet_entries cascade;
drop table if exists public.sheets cascade;

-- 3. Application functions (new + legacy) -----------------------------------
drop function if exists public.is_event_admin();
drop function if exists public.is_event_visible(uuid);
drop function if exists public.is_event_party_visible(uuid);
drop function if exists public.is_event_slot_visible(uuid);
drop function if exists public.claim_event_slot(uuid, text);
drop function if exists public.leave_event_slot(uuid);
drop function if exists public.save_event(uuid, jsonb);
drop function if exists public.set_event_status(uuid, text);
drop function if exists public.duplicate_event(uuid);
drop function if exists public.admin_set_signup(uuid, uuid);
drop function if exists public.admin_user_action(text, uuid, jsonb);
drop function if exists public.update_own_profile(text, text);
drop function if exists public.handle_new_user();
drop function if exists public.touch_updated_at();

drop function if exists public.is_platform_admin();
drop function if exists public.is_team_member(uuid);
drop function if exists public.is_team_editable(uuid);
drop function if exists public.shares_team_with_me(uuid);
drop function if exists public.admin_action(text, uuid, uuid, uuid, jsonb, uuid);
drop function if exists public.claim_mass_slot(uuid, text);
drop function if exists public.unclaim_mass_slot(uuid);
drop function if exists public.save_mass_sheet(uuid, jsonb);
drop function if exists public.duplicate_mass_sheet(uuid);
drop function if exists public.set_mass_sheet_status(uuid, text);
drop function if exists public.admin_set_slot_assignment(uuid, uuid, text);
drop function if exists public.update_member_field(uuid, text, text);
drop function if exists public.revert_member_field(uuid, text, text, text);
drop function if exists public.ensure_profile();
drop function if exists public.touch_login();
drop function if exists public.check_ign_available(text);
drop function if exists public.claim_first_admin();
drop function if exists public.log_audit(text, uuid, uuid, uuid, jsonb);
drop function if exists public.notify_user(uuid, text, text, text, text);
drop function if exists public.handle_membership_change();
drop function if exists public.handle_team_change();
drop function if exists public.handle_profile_update();
drop function if exists public.handle_profile_status_change();
drop function if exists public.handle_mass_sheet_update();
drop function if exists public.recent_own_activity(integer);

-- 4. Legacy triggers on auth.users (recreated by 0001 on push) ---------------
drop trigger if exists on_auth_user_created on auth.users;

-- 5. Realtime publication: remove app tables (kept if the publication exists)
do $$
declare
  t record;
begin
  if exists (select 1 from pg_publication where pubname = 'supabase_realtime') then
    for t in select tablename from pg_publication_tables
            where pubname = 'supabase_realtime' and schemaname = 'public'
    loop
      execute format('alter publication supabase_realtime drop table public.%I', t.tablename);
    end loop;
  end if;
end
$$;

-- 6. Migration tracking (so db:push re-applies everything fresh) ------------
drop table if exists public.schema_migrations cascade;

-- ============================================================================
-- DONE. Recreate the schema with:  npm run db:push
-- Verify with:                     npm run db:doctor
-- ============================================================================
