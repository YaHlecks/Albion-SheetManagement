-- ============================================================================
-- 0002 — AUTH / PROFILE LAYER
--
-- Repairs the application↔database contract broken when the event-architecture
-- migration 0001 dropped these objects while the app still called them:
--
--   * ensure_profile()            — login/verify-email self-heal (RPC missing →
--                                   PostgREST 404 "not found in the schema cache",
--                                   which the UI then misread as a broken session)
--   * touch_login()               — login timestamp writer
--   * check_ign_available(text)   — anonymous registration IGN availability
--   * claim_first_admin()         — one-time first-admin self-heal
--   * profiles.last_login_at / approved_at / suspended_at
--                                 — selected by 5 UI files and written by
--                                   admin_user_action(); 42703 "column does not
--                                   exist" broke every profile load (and with it
--                                   admin dashboard access)
--
-- Behavior is carried over from the audited legacy implementation, adapted to
-- the event schema. All functions are SECURITY DEFINER with a pinned
-- search_path, identity always from auth.uid()/JWT (never client input),
-- execute granted only to the roles the app uses.
-- ============================================================================

-- ----------------------------------------------------------------------------
-- 1. PROFILES: add the three timestamp columns the app contract requires
-- ----------------------------------------------------------------------------
alter table public.profiles add column if not exists last_login_at timestamptz;
alter table public.profiles add column if not exists approved_at  timestamptz;
alter table public.profiles add column if not exists suspended_at timestamptz;

-- ----------------------------------------------------------------------------
-- 2. RPC: ensure_profile()
--
-- Called by the login page and verify-email page right after sign-in.
-- Creates the profile row if the signup trigger has not run (or failed) yet,
-- so a race between authentication and profile creation can never crash the
-- first login. Identity always comes from the verified JWT — never from
-- client-supplied user IDs. Deliberately does NOT grant admin: that path
-- exists only in the signup trigger (first account) and claim_first_admin().
-- ----------------------------------------------------------------------------
create or replace function public.ensure_profile()
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_claims jsonb;
  v_ign text;
  v_discord text;
  v_row public.profiles;
begin
  if auth.uid() is null then
    return jsonb_build_object('ok', false, 'error', 'UNAUTHENTICATED');
  end if;

  select * into v_row from public.profiles where id = auth.uid();
  if found then
    return jsonb_build_object(
      'ok', true, 'created', false,
      'status', v_row.status, 'is_platform_admin', v_row.is_platform_admin
    );
  end if;

  v_claims := nullif(current_setting('request.jwt.claims', true), '')::jsonb;
  v_ign := nullif(trim(coalesce(v_claims->'user_metadata'->>'ign', '')), '');
  v_discord := nullif(trim(coalesce(v_claims->'user_metadata'->>'discord', '')), '');

  if v_ign is null or char_length(v_ign) < 2 or char_length(v_ign) > 32 then
    v_ign := 'player-' || left(auth.uid()::text, 8);
  end if;
  if v_discord is not null and char_length(v_discord) > 64 then
    v_discord := left(v_discord, 64);
  end if;

  -- De-duplicate: ign is unique — a collision must not fail provisioning.
  if exists (select 1 from public.profiles where lower(ign) = lower(v_ign)) then
    declare
      v_n integer := 1;
    begin
      while exists (select 1 from public.profiles where lower(ign) = lower(v_ign || '-' || v_n))
        loop v_n := v_n + 1; end loop;
      v_ign := left(v_ign || '-' || v_n, 32);
    end;
  end if;

  insert into public.profiles (id, ign, discord, status, is_platform_admin)
  values (auth.uid(), v_ign, v_discord, 'pending', false)
  on conflict (id) do nothing;

  select * into v_row from public.profiles where id = auth.uid();
  return jsonb_build_object(
    'ok', true, 'created', true,
    'status', v_row.status, 'is_platform_admin', v_row.is_platform_admin
  );
end;
$$;

revoke all on function public.ensure_profile() from public, anon;
grant execute on function public.ensure_profile() to authenticated, service_role;

-- ----------------------------------------------------------------------------
-- 3. RPC: touch_login()
--
-- Called by the login page after a successful sign-in. Sets last_login_at;
-- the profile-update trigger (below) writes the USER_LOGIN audit event.
-- ----------------------------------------------------------------------------
create or replace function public.touch_login()
returns void
language sql
security definer
set search_path = public
as $$
  update public.profiles set last_login_at = now() where id = auth.uid();
$$;

revoke all on function public.touch_login() from public, anon;
grant execute on function public.touch_login() to authenticated, service_role;

-- ----------------------------------------------------------------------------
-- 4. RPC: check_ign_available(text)
--
-- Used by the anonymous registration form: visitors cannot read profiles via
-- RLS, so availability is checked inside the database instead. Fail-open in
-- the UI; the ign unique constraint remains authoritative.
-- ----------------------------------------------------------------------------
create or replace function public.check_ign_available(p_ign text)
returns boolean
language sql
security definer
set search_path = public
stable
as $$
  select not exists (
    select 1 from public.profiles where lower(ign) = lower(p_ign)
  );
$$;

revoke all on function public.check_ign_available(text) from public;
grant execute on function public.check_ign_available(text) to anon, authenticated;

-- ----------------------------------------------------------------------------
-- 5. RPC: claim_first_admin()
--
-- Self-healing repair for deployments whose earliest account registered
-- BEFORE the first-admin rule existed in handle_new_user: that account is
-- stuck as pending/non-admin and can never reach the admin UI to fix itself.
-- The authenticated caller (identity = auth.uid(), never client input) is
-- promoted IF AND ONLY IF it is the earliest profile AND no administrator
-- exists. Otherwise a no-op that merely reports the caller's state. Advisory
-- lock keeps it race-free against concurrent registrations and itself.
-- Idempotent: safe to call on every login. Promotion is audited.
-- ----------------------------------------------------------------------------
create or replace function public.claim_first_admin()
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_row public.profiles;
  v_earliest uuid;
  v_promoted boolean := false;
begin
  if auth.uid() is null then
    return jsonb_build_object('ok', false, 'error', 'UNAUTHENTICATED');
  end if;

  perform pg_advisory_xact_lock(hashtext('albion-events:first-admin'));

  select * into v_row from public.profiles where id = auth.uid();
  if not found then
    -- ensure_profile() handles provisioning; this RPC only repairs roles.
    return jsonb_build_object('ok', false, 'error', 'PROFILE_MISSING');
  end if;

  if not coalesce(v_row.is_platform_admin, false) then
    if not exists (select 1 from public.profiles where is_platform_admin) then
      select p.id into v_earliest
        from public.profiles p
        order by p.created_at asc, p.id asc
        limit 1;
      if v_earliest = auth.uid() then
        update public.profiles
           set is_platform_admin = true,
               status = 'approved',
               approved_at = coalesce(approved_at, now())
         where id = auth.uid();
        v_promoted := true;
        insert into public.audit_logs (action, actor_id, target_user_id, meta)
        values (
          'PERMISSION_CHANGED', auth.uid(), auth.uid(),
          jsonb_build_object(
            'reason', 'first-account self-heal: earliest account promoted to platform administrator',
            'granted_by', 'claim_first_admin RPC'
          )
        );
      end if;
    end if;
  end if;

  if v_promoted then
    select * into v_row from public.profiles where id = auth.uid();
  end if;

  return jsonb_build_object(
    'ok', true,
    'promoted', v_promoted,
    'status', v_row.status,
    'is_platform_admin', v_row.is_platform_admin
  );
end;
$$;

revoke all on function public.claim_first_admin() from public, anon;
grant execute on function public.claim_first_admin() to authenticated, service_role;

-- ----------------------------------------------------------------------------
-- 6. PROFILE UPDATE TRIGGER (replaces the bare updated_at toucher)
--
--   * keeps updated_at fresh
--   * writes the USER_LOGIN audit event when touch_login() stamps a new
--     last_login_at (no auth.users login trigger exists; Supabase does not
--     fire one on token refresh — the client calls touch_login post-signin)
--   * guard: non-admins can never change status or the admin flag. When
--     auth.uid() is null (trusted server context, e.g. service-role or the
--     signup trigger) the write is allowed because it originates from the
--     application server itself. This is database-side enforcement (§23/§32):
--     a member cannot self-approve or self-promote through any client path.
-- ----------------------------------------------------------------------------
create or replace function public.handle_profile_update()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  new.updated_at := now();

  if old.last_login_at is distinct from new.last_login_at then
    insert into public.audit_logs (action, actor_id, target_user_id, meta)
    values ('USER_LOGIN', new.id, new.id, jsonb_build_object());
  end if;

  if new.status is distinct from old.status
     or new.is_platform_admin is distinct from old.is_platform_admin then
    if auth.uid() is not null and not coalesce(
      (select p.is_platform_admin from public.profiles p where p.id = auth.uid()), false) then
      raise exception 'Only administrators can change account status or admin flag';
    end if;
  end if;

  return new;
end;
$$;

drop trigger if exists on_profiles_update on public.profiles;
create trigger on_profiles_update
  before update on public.profiles
  for each row execute function public.handle_profile_update();

-- ----------------------------------------------------------------------------
-- 7. REALTIME — notifications (unread badge updates without polling)
-- ----------------------------------------------------------------------------
do $$
begin
  if exists (select 1 from pg_publication where pubname = 'supabase_realtime') then
    if not exists (select 1 from pg_publication_tables
      where pubname = 'supabase_realtime' and schemaname = 'public' and tablename = 'notifications') then
      alter publication supabase_realtime add table public.notifications;
    end if;
  end if;
end
$$;
