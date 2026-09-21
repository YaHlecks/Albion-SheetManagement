-- ============================================================================
-- ONE-TIME: designate the initial platform administrator.
--
-- Run ONCE, after your admin user has registered (they can register normally
-- through /register — the account starts as "pending"). Run this script via
-- the Supabase SQL Editor, or `npm run db:bootstrap -- admin@example.com`.
--
-- Why a script instead of "first user becomes admin": an automatic rule is
-- either controllable by an attacker (register first, own the platform) or
-- wrong after a deploy (the "first" slot is already taken). A one-time,
-- operator-run, auditable SQL step is the standard Supabase bootstrap.
--
-- The script:
--   1. verifies the account exists in auth.users,
--   2. creates the profile row if the signup trigger has not fired yet,
--   3. promotes it to is_platform_admin,
--   4. approves it (so the admin can actually reach the admin UI),
--   5. writes an auditable PERMISSION_CHANGED event.
-- Re-running is safe: it re-promotes the same account and writes no extra
-- rows if the account is already an approved admin.
-- ============================================================================

do $$
declare
  -- <<< EDIT: the email of the account you registered as your admin >>>
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
