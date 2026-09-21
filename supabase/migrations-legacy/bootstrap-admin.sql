-- ============================================================================
-- RECOVERY: designate/restore a platform administrator.
--
-- Normally you do NOT need this script: in a fresh deployment the first
-- account to register automatically becomes the platform administrator
-- (decided race-safely inside the handle_new_user trigger — see
-- 0001_init.sql). Use this script only when:
--   * the database already had users before the first-admin rule existed,
--   * the intended admin registered second, or
--   * all administrators were somehow removed and you must restore one.
--
-- Run via the Supabase SQL Editor (edit v_email below first), or:
--   npm run db:bootstrap -- admin@example.com
--
-- The script verifies the account exists in auth.users, creates the profile
-- row if missing, promotes it to is_platform_admin, approves it, and writes
-- an auditable PERMISSION_CHANGED event. Re-running is safe.
-- ============================================================================

do $$
declare
  -- <<< EDIT: the email of the account to promote >>>
  v_email text := 'admin@example.com';

  v_user auth.users;
  v_row public.profiles;
begin
  select * into v_user from auth.users
    where lower(email) = lower(v_email);

  if v_user.id is null then
    raise exception 'No auth.users row found for %. Register through /register first, then re-run this script.', v_email;
  end if;

  -- Ensure a profile exists even if the signup trigger has not fired yet.
  insert into public.profiles (id, ign, discord, status, is_platform_admin)
  values (
    v_user.id,
    coalesce(nullif(trim(v_user.raw_user_meta_data->>'ign'), ''), 'admin-' || left(v_user.id::text, 8)),
    nullif(trim(v_user.raw_user_meta_data->>'discord'), ''),
    'approved',
    true
  )
  on conflict (id) do nothing;

  -- Promote + approve. (The status change fires the USER_APPROVED trigger.)
  update public.profiles
     set is_platform_admin = true,
         status = 'approved',
         approved_at = coalesce(approved_at, now())
   where id = v_user.id;

  if not found then
    raise exception 'Profile row could not be updated for user %', v_user.id;
  end if;

  select * into v_row from public.profiles where id = v_user.id;

  -- Explicit attribution row (the status trigger records the approval too).
  insert into public.audit_logs (action, actor_id, target_user_id, meta)
  values (
    'PERMISSION_CHANGED',
    v_user.id,
    v_user.id,
    jsonb_build_object(
      'reason', 'bootstrap initial administrator',
      'granted_by', 'bootstrap-admin.sql'
    )
  );

  raise notice 'Admin ready: % (ign=%, status=%, is_platform_admin=%)',
    v_email, v_row.ign, v_row.status, v_row.is_platform_admin;
end $$;
