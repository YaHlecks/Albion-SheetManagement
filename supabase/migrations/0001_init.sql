-- ============================================================================
-- Albion Team Sheets — initial schema
-- Postgres (Supabase). Run with: npm run db:push
-- ============================================================================

create extension if not exists pgcrypto;

-- ----------------------------------------------------------------------------
-- PROFILES (1-1 with auth.users; auth data stays in the auth provider)
-- ----------------------------------------------------------------------------
create table if not exists public.profiles (
  id uuid primary key references auth.users(id) on delete cascade,
  ign text not null check (char_length(ign) between 2 and 32),
  discord text check (discord is null or char_length(discord) <= 64),
  status text not null default 'pending'
    check (status in ('pending','approved','rejected','suspended','archived')),
  is_platform_admin boolean not null default false,
  created_at timestamptz not null default now(),
  last_login_at timestamptz,
  approved_at timestamptz,
  approved_by uuid references public.profiles(id),
  rejected_at timestamptz,
  rejected_by uuid references public.profiles(id),
  suspended_at timestamptz,
  suspended_by uuid references public.profiles(id)
);

create index if not exists profiles_status_idx on public.profiles (status);
-- IGNs are unique (case-insensitive). The check_ign_available RPC and the
-- profile form rely on this; the database is the authority, not the UI.
drop index if exists profiles_ign_idx;
create unique index if not exists profiles_ign_unique_idx on public.profiles (lower(ign));

-- ----------------------------------------------------------------------------
-- TEAMS
-- ----------------------------------------------------------------------------
create table if not exists public.teams (
  id uuid primary key default gen_random_uuid(),
  name text not null check (char_length(name) between 2 and 60),
  description text check (description is null or char_length(description) <= 500),
  status text not null default 'draft' check (status in ('draft','open','locked','archived')),
  sheet_locked boolean not null default false,
  created_by uuid references public.profiles(id),
  created_at timestamptz not null default now(),
  archived_at timestamptz
);

create index if not exists teams_status_idx on public.teams (status);

-- ----------------------------------------------------------------------------
-- TEAM MEMBERS (membership is separate from account approval)
-- ----------------------------------------------------------------------------
create table if not exists public.team_members (
  id uuid primary key default gen_random_uuid(),
  team_id uuid not null references public.teams(id) on delete cascade,
  user_id uuid not null references public.profiles(id) on delete cascade,
  role text not null default 'DPS'
    check (role in ('Tank','Healer','DPS','Support','Leader')),
  weapon text check (weapon is null or char_length(weapon) <= 60),
  availability text check (availability is null or char_length(availability) <= 200),
  notes text check (notes is null or char_length(notes) <= 300),
  joined_at timestamptz not null default now(),
  added_by uuid references public.profiles(id),
  unique (team_id, user_id)
);

create index if not exists team_members_user_idx on public.team_members (user_id);
create index if not exists team_members_team_idx on public.team_members (team_id);

-- ----------------------------------------------------------------------------
-- NOTIFICATIONS
-- ----------------------------------------------------------------------------
create table if not exists public.notifications (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references public.profiles(id) on delete cascade,
  title text not null check (char_length(title) between 1 and 120),
  body text check (body is null or char_length(body) <= 400),
  type text not null default 'info' check (type in ('info','success','warning','error')),
  read boolean not null default false,
  link text check (link is null or char_length(link) <= 200),
  created_at timestamptz not null default now()
);

create index if not exists notifications_user_idx on public.notifications (user_id, created_at desc);

-- ----------------------------------------------------------------------------
-- AUDIT LOG (append-only; old/new values captured as JSONB)
-- ----------------------------------------------------------------------------
create table if not exists public.audit_logs (
  id uuid primary key default gen_random_uuid(),
  action text not null,
  actor_id uuid references public.profiles(id),
  target_user_id uuid references public.profiles(id),
  team_id uuid references public.teams(id),
  meta jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now()
);

create index if not exists audit_logs_created_idx on public.audit_logs (created_at desc);
create index if not exists audit_logs_actor_idx on public.audit_logs (actor_id, created_at desc);
create index if not exists audit_logs_team_idx on public.audit_logs (team_id, created_at desc);
create index if not exists audit_logs_action_idx on public.audit_logs (action);

-- ----------------------------------------------------------------------------
-- FUNCTIONS
-- ----------------------------------------------------------------------------

-- Admin check usable inside RLS policies (avoids recursive self-references).
create or replace function public.is_platform_admin()
returns boolean
language sql
security definer
set search_path = public
stable
as $$
  select coalesce(
    (select p.is_platform_admin from public.profiles p where p.id = auth.uid()),
    false
  );
$$;

-- Generic notifier: inserts a notification row bypassing RLS via definer rights.
-- HARDENED: regular authenticated members cannot call this to spoof
-- notifications for other users. Only administrators (whose credentials also
-- fire the membership/status triggers that call it) and the trusted server
-- context (service role, where auth.uid() is null) may notify.
create or replace function public.notify_user(
  p_user_id uuid,
  p_title text,
  p_body text default null,
  p_type text default 'info',
  p_link text default null
)
returns void
language plpgsql
security definer
set search_path = public
as $$
begin
  if auth.uid() is not null then
    if not coalesce(
      (select p.is_platform_admin from public.profiles p where p.id = auth.uid()), false) then
      raise exception 'FORBIDDEN';
    end if;
  end if;

  insert into public.notifications (user_id, title, body, type, link)
  values (p_user_id, p_title, p_body, p_type, p_link);
end;
$$;

revoke all on function public.notify_user(uuid, text, text, text, text) from public, anon;
grant execute on function public.notify_user(uuid, text, text, text, text) to authenticated;
grant execute on function public.notify_user(uuid, text, text, text, text) to service_role;

-- Security-definer audit writer for sessions without service-role access.
-- HARDENED: callers cannot forge arbitrary audit events. Routine events are
-- recorded automatically by triggers; client-initiated audit writes are
-- limited to logout (any authenticated user) and a small admin-only
-- allow-list. Anything else is rejected inside the database.
create or replace function public.log_audit(
  p_action text,
  p_target_user_id uuid default null,
  p_team_id uuid default null,
  p_meta jsonb default '{}'::jsonb
)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  v_admin boolean;
begin
  if p_action not in (
    'USER_LOGOUT',
    'CHANGE_REVERTED',
    'PERMISSION_CHANGED',
    'TEAM_CREATED',
    'TEAM_RESTORED',
    'TEAM_STATUS_CHANGED'
  ) then
    raise exception 'audit action % is recorded automatically by the database', p_action;
  end if;

  if p_action <> 'USER_LOGOUT' then
    select coalesce(is_platform_admin, false) into v_admin
      from public.profiles where id = auth.uid();
    if not v_admin then
      raise exception 'FORBIDDEN';
    end if;
  end if;

  insert into public.audit_logs (action, actor_id, target_user_id, team_id, meta)
  values (p_action, auth.uid(), p_target_user_id, p_team_id, p_meta);
end;
$$;

revoke all on function public.log_audit(text, uuid, uuid, jsonb) from public, anon;
grant execute on function public.log_audit(text, uuid, uuid, jsonb) to authenticated;

-- ============================================================================
-- NON-RECURSIVE RLS HELPERS
--
-- Every authorization check used inside a policy is a security-definer
-- function: it runs as the table owner and therefore evaluates WITHOUT
-- applying RLS. This is exactly what breaks the 42P17 "infinite recursion
-- detected in policy" error, which occurs when a policy on table X queries
-- table X directly (or a chain of policies references each other in a
-- circle). These functions are narrow predicates: they can only answer
-- "is this true for the caller" and cannot leak or mutate rows.
-- ============================================================================

-- Is the current user a member of the given team?
create or replace function public.is_team_member(p_team_id uuid)
returns boolean
language sql
security definer
set search_path = public
stable
as $$
  select exists (
    select 1 from public.team_members tm
    where tm.team_id = p_team_id and tm.user_id = auth.uid()
  );
$$;

-- Is the given team sheet currently editable by regular members?
create or replace function public.is_team_editable(p_team_id uuid)
returns boolean
language sql
security definer
set search_path = public
stable
as $$
  select exists (
    select 1 from public.teams t
    where t.id = p_team_id
      and t.status in ('open', 'draft')
      and t.sheet_locked = false
  );
$$;

-- Does the current user share at least one team with the given user?
-- (Lets teammates see each other's IGN on the sheet without making profiles
-- world-readable.)
create or replace function public.shares_team_with_me(p_other_user uuid)
returns boolean
language sql
security definer
set search_path = public
stable
as $$
  select exists (
    select 1
    from public.team_members mine
    join public.team_members theirs on theirs.team_id = mine.team_id
    where mine.user_id = auth.uid()
      and theirs.user_id = p_other_user
  );
$$;

-- Policy predicates need EXECUTE for every role policies run as.
grant execute on function public.is_team_member(uuid) to anon, authenticated;
grant execute on function public.is_team_editable(uuid) to anon, authenticated;
grant execute on function public.shares_team_with_me(uuid) to anon, authenticated;

-- ============================================================================
-- RPC: first-login profile provisioning (self-healing)
--
-- Called right after sign-in. Creates the profile row if the signup trigger
-- has not run (or failed) yet, so a race between authentication and profile
-- creation can never crash the first login. Identity always comes from the
-- verified JWT — never from client-supplied user IDs. Deliberately does NOT
-- grant admin: that path exists only in the signup trigger (first account)
-- and the one-time bootstrap script (supabase/bootstrap-admin.sql).
-- ============================================================================
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
grant execute on function public.ensure_profile() to authenticated;

-- ============================================================================
-- RPC: a member's own recent activity
--
-- Members must not read the audit_logs table (admin-only by policy), but the
-- dashboard shows "what did I change". This definer function returns only
-- events where the caller is the actor or the target.
-- ============================================================================
create or replace function public.recent_own_activity(p_limit int default 10)
returns table (
  id uuid,
  action text,
  created_at timestamptz,
  meta jsonb,
  team_name text
)
language sql
security definer
set search_path = public
stable
as $$
  select a.id, a.action, a.created_at, a.meta, t.name
  from public.audit_logs a
  left join public.teams t on t.id = a.team_id
  where a.actor_id = auth.uid() or a.target_user_id = auth.uid()
  order by a.created_at desc
  limit greatest(1, least(coalesce(p_limit, 10), 50));
$$;

revoke all on function public.recent_own_activity(int) from public, anon;
grant execute on function public.recent_own_activity(int) to authenticated;

-- ============================================================================
-- TRIGGER: new auth user -> pending profile + USER_REGISTERED audit event
-- ============================================================================
create or replace function public.handle_new_user()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  new_ign text;
  new_discord text;
begin
  -- Idempotent guard: rerunning the migration (or overlapping triggers) must
  -- never create a duplicate profile.
  if exists (select 1 from public.profiles where id = new.id) then
    return new;
  end if;

  new_ign := nullif(trim(new.raw_user_meta_data->>'ign'), '');
  new_discord := nullif(trim(new.raw_user_meta_data->>'discord'), '');

  if new_ign is null or char_length(new_ign) < 2 or char_length(new_ign) > 32 then
    new_ign := 'player-' || left(new.id::text, 8);
  end if;

  if new_discord is not null and char_length(new_discord) > 64 then
    new_discord := left(new_discord, 64);
  end if;

  -- is_platform_admin is deliberately NOT auto-granted here. The initial
  -- administrator is established by the one-time, auditable script
  -- supabase/bootstrap-admin.sql (see README "First administrator").
  insert into public.profiles (id, ign, discord, status, is_platform_admin)
  values (new.id, new_ign, new_discord, 'pending', false)
  on conflict (id) do nothing;

  insert into public.audit_logs (action, actor_id, target_user_id, meta)
  values ('USER_REGISTERED', new.id, new.id,
    jsonb_build_object('ign', new_ign, 'email', new.email));

  return new;
end;
$$;

drop trigger if exists on_auth_user_created on auth.users;
create trigger on_auth_user_created
  after insert on auth.users
  for each row execute function public.handle_new_user();

-- ============================================================================
-- TRIGGER HELPERS: audit actor resolution
--
-- Audit triggers stamp the actor from auth.uid(); when a write arrives via
-- the service-role path (trusted server), auth.uid() is null and the actor
-- comes from the transaction-scoped app.actor_id GUC that admin_action set
-- from its server-verified session. auth.uid() always wins, so a client
-- session can never forge another actor.
-- ============================================================================
create or replace function public.audit_actor()
returns uuid
language sql
stable
as $$
  select coalesce(
    auth.uid(),
    nullif(current_setting('app.actor_id', true), '')::uuid
  );
$$;

-- ============================================================================
-- TRIGGER: profile update guard + login tracking
--
-- USER_LOGIN events are written here: the client calls touch_login() after
-- sign-in, which updates last_login_at and fires this trigger. There is no
-- separate login trigger on auth.users (Supabase does not fire triggers on
-- token refresh, and a session is established before touch_login runs).
-- ============================================================================
create or replace function public.handle_profile_update()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  -- Login tracking: profile updated with a new last_login_at timestamp.
  if old.last_login_at is distinct from new.last_login_at then
    insert into public.audit_logs (action, actor_id, target_user_id, meta)
    values ('USER_LOGIN', new.id, new.id, jsonb_build_object());
  end if;

  -- Guard: non-admins cannot change status or the admin flag. When auth.uid()
  -- is null (trusted server context, e.g. service-role writes), the write is
  -- allowed because it originates from the application server itself.
  if new.status is distinct from old.status or new.is_platform_admin is distinct from old.is_platform_admin then
    if auth.uid() is not null and not coalesce(
      (select p.is_platform_admin from public.profiles p where p.id = auth.uid()), false) then
      raise exception 'Only administrators can change account status or admin flag';
    end if;
  end if;

  return new;
end;
$$;

drop trigger if exists on_profile_update on public.profiles;
drop trigger if exists on_profile_update on public.profiles;
create trigger on_profile_update
  before update on public.profiles
  for each row
  execute function public.handle_profile_update();

-- ============================================================================
-- RPC: record a login (sets last_login_at; the profile-update trigger writes
-- the USER_LOGIN audit event). Called by the client right after sign-in.
-- ============================================================================
create or replace function public.touch_login()
returns void
language sql
security definer
set search_path = public
as $$
  update public.profiles set last_login_at = now() where id = auth.uid();
$$;

grant execute on function public.touch_login() to authenticated;

-- Registration helper: anonymous visitors must be able to check IGN
-- availability without being able to read the profiles table via RLS.
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

grant execute on function public.check_ign_available(text) to anon, authenticated;

-- ============================================================================
-- TRIGGER: audit profile status changes (approval, rejection, suspension…)
-- ============================================================================
create or replace function public.handle_profile_status_change()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  actor uuid := public.audit_actor();
  action_type text;
begin
  if old.status is distinct from new.status then
    action_type := case new.status
      when 'approved'   then 'USER_APPROVED'
      when 'rejected'   then 'USER_REJECTED'
      when 'suspended'  then 'USER_SUSPENDED'
      when 'archived'   then 'USER_ARCHIVED'
      when 'pending'    then 'USER_REACTIVATED'
      else 'PERMISSION_CHANGED'
    end;

    insert into public.audit_logs (action, actor_id, target_user_id, meta)
    values (action_type, actor, new.id,
      jsonb_build_object('previous_status', old.status, 'new_status', new.status));
  end if;

  return new;
end;
$$;

drop trigger if exists on_profile_status_change on public.profiles;
create trigger on_profile_status_change
  after update on public.profiles
  for each row
  when (old.status is distinct from new.status)
  execute function public.handle_profile_status_change();

-- ============================================================================
-- TRIGGER: audit team changes (rename / lock / unlock / archive)
-- ============================================================================
create or replace function public.handle_team_change()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  actor uuid := public.audit_actor();
begin
  if old.name is distinct from new.name then
    insert into public.audit_logs (action, actor_id, team_id, meta)
    values ('TEAM_RENAMED', actor, new.id,
      jsonb_build_object('previous', old.name, 'new', new.name));
  end if;

  if old.sheet_locked is distinct from new.sheet_locked then
    insert into public.audit_logs (action, actor_id, team_id, meta)
    values (
      case when new.sheet_locked then 'SHEET_LOCKED' else 'SHEET_UNLOCKED' end,
      actor, new.id, jsonb_build_object('previous', old.sheet_locked, 'new', new.sheet_locked)
    );
  end if;

  if old.status is distinct from new.status then
    if new.status = 'archived' then
      insert into public.audit_logs (action, actor_id, team_id, meta)
      values ('TEAM_ARCHIVED', actor, new.id,
        jsonb_build_object('previous_status', old.status));
    elsif new.status = 'open' and old.status = 'draft' then
      insert into public.audit_logs (action, actor_id, team_id, meta)
      values ('TEAM_OPENED', actor, new.id, jsonb_build_object('previous_status', old.status));
    end if;
  end if;

  return new;
end;
$$;

drop trigger if exists on_team_change on public.teams;
create trigger on_team_change
  after update on public.teams
  for each row
  when (old.name is distinct from new.name
     or old.status is distinct from new.status
     or old.sheet_locked is distinct from new.sheet_locked)
  execute function public.handle_team_change();

-- ============================================================================
-- TRIGGER: audit membership changes + notifications
-- ============================================================================
create or replace function public.handle_membership_change()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  actor uuid := public.audit_actor();
  team_name text;
begin
  select t.name into team_name from public.teams t
    where t.id = coalesce(new.team_id, old.team_id);

  if (tg_op = 'INSERT') then
    insert into public.audit_logs (action, actor_id, target_user_id, team_id, meta)
    values ('MEMBER_ADDED', actor, new.user_id, new.team_id,
      jsonb_build_object('role', new.role, 'team_name', team_name));

    perform public.notify_user(
      new.user_id,
      'Added to ' || team_name,
      'You have been added to ' || team_name || ' as ' || new.role || '.',
      'success',
      '/teams/' || new.team_id::text
    );
  elsif (tg_op = 'DELETE') then
    insert into public.audit_logs (action, actor_id, target_user_id, team_id, meta)
    values ('MEMBER_REMOVED', actor, old.user_id, old.team_id,
      jsonb_build_object('team_name', team_name));

    perform public.notify_user(
      old.user_id,
      'Removed from ' || team_name,
      'You have been removed from ' || team_name || '.',
      'warning',
      '/teams'
    );
  end if;

  return coalesce(new, old);
end;
$$;

drop trigger if exists on_membership_insert on public.team_members;
create trigger on_membership_insert
  after insert on public.team_members
  for each row execute function public.handle_membership_change();

drop trigger if exists on_membership_delete on public.team_members;
create trigger on_membership_delete
  after delete on public.team_members
  for each row execute function public.handle_membership_change();

-- ============================================================================
-- TRIGGER: audit sheet field changes with previous/new values
-- ============================================================================
create or replace function public.handle_member_field_change()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  actor uuid := public.audit_actor();
  changed_field text := null;
  previous_value text := null;
  new_value text := null;
begin
  if new.role is distinct from old.role then
    changed_field := 'role'; previous_value := old.role; new_value := new.role;
  elsif new.weapon is distinct from old.weapon then
    changed_field := 'weapon'; previous_value := old.weapon; new_value := new.weapon;
  elsif new.availability is distinct from old.availability then
    changed_field := 'availability'; previous_value := old.availability; new_value := new.availability;
  elsif new.notes is distinct from old.notes then
    changed_field := 'notes'; previous_value := old.notes; new_value := new.notes;
  end if;

  if changed_field is not null then
    insert into public.audit_logs (action, actor_id, target_user_id, team_id, meta)
    values ('FIELD_UPDATED', actor, new.user_id, new.team_id,
      jsonb_build_object('field', changed_field, 'previous', previous_value, 'new', new_value));
  end if;

  return new;
end;
$$;

drop trigger if exists on_member_field_change on public.team_members;
create trigger on_member_field_change
  after update on public.team_members
  for each row
  when (new.role is distinct from old.role
     or new.weapon is distinct from old.weapon
     or new.availability is distinct from old.availability
     or new.notes is distinct from old.notes)
  execute function public.handle_member_field_change();

-- ============================================================================
-- RPC: atomic member field update (permission + lock + status re-checks)
-- ============================================================================
create or replace function public.update_member_field(
  p_member_id uuid,
  p_field text,
  p_value text
)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_member public.team_members;
  v_team public.teams;
  v_is_admin boolean;
  v_own_row boolean;
begin
  select * into v_member from public.team_members where id = p_member_id;
  if not found then
    return jsonb_build_object('ok', false, 'error', 'NOT_FOUND');
  end if;

  select * into v_team from public.teams where id = v_member.team_id;

  v_is_admin := coalesce(
    (select p.is_platform_admin from public.profiles p where p.id = auth.uid()), false);
  v_own_row := v_member.user_id = auth.uid();

  if coalesce(
    (select p.status from public.profiles p where p.id = auth.uid()), 'pending') <> 'approved' then
    return jsonb_build_object('ok', false, 'error', 'ACCOUNT_NOT_APPROVED');
  end if;

  if not v_is_admin and not v_own_row then
    return jsonb_build_object('ok', false, 'error', 'FORBIDDEN');
  end if;

  if v_team.sheet_locked and not v_is_admin then
    return jsonb_build_object('ok', false, 'error', 'SHEET_LOCKED');
  end if;

  if v_team.status not in ('open', 'draft') then
    return jsonb_build_object('ok', false, 'error', 'TEAM_NOT_EDITABLE');
  end if;

  if p_field not in ('role', 'weapon', 'availability', 'notes') then
    return jsonb_build_object('ok', false, 'error', 'INVALID_FIELD');
  end if;

  if p_field = 'role' and p_value not in ('Tank','Healer','DPS','Support','Leader') then
    return jsonb_build_object('ok', false, 'error', 'INVALID_VALUE');
  end if;

  update public.team_members
     set role         = case when p_field = 'role' then p_value else role end,
         weapon       = case when p_field = 'weapon' then nullif(trim(p_value), '') else weapon end,
         availability = case when p_field = 'availability' then nullif(trim(p_value), '') else availability end,
         notes        = case when p_field = 'notes' then nullif(trim(p_value), '') else notes end
   where id = p_member_id;

  return jsonb_build_object('ok', true);
end;
$$;

revoke all on function public.update_member_field(uuid, text, text) from public, anon;
grant execute on function public.update_member_field(uuid, text, text) to authenticated;

-- ============================================================================
-- RPC: revert a field change (admin only; preserves history)
-- ============================================================================
create or replace function public.revert_member_field(
  p_member_id uuid,
  p_field text,
  p_previous_value text
)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_is_admin boolean;
begin
  select coalesce(is_platform_admin, false) into v_is_admin
    from public.profiles where id = auth.uid();
  if not v_is_admin then
    return jsonb_build_object('ok', false, 'error', 'FORBIDDEN');
  end if;

  if not exists (select 1 from public.team_members where id = p_member_id) then
    return jsonb_build_object('ok', false, 'error', 'NOT_FOUND');
  end if;

  update public.team_members
     set role         = case when p_field = 'role' then p_previous_value else role end,
         weapon       = case when p_field = 'weapon' then p_previous_value else weapon end,
         availability = case when p_field = 'availability' then p_previous_value else availability end,
         notes        = case when p_field = 'notes' then p_previous_value else notes end
   where id = p_member_id;

  return jsonb_build_object('ok', true);
end;
$$;

revoke all on function public.revert_member_field(uuid, text, text) from public, anon;
grant execute on function public.revert_member_field(uuid, text, text) to authenticated;

-- ============================================================================
-- RPC: generic admin actions.
-- Two secure entry paths, both re-verified INSIDE the function:
--   1. User session: caller's JWT must belong to an approved platform admin.
--   2. Trusted server: service-role key (no user JWT). auth.uid() is null,
--      so the acting admin's identity arrives via p_actor_id, which the
--      application server sets from its own server-verified session — never
--      from the browser. Triggers pick it up through the transaction-scoped
--      app.actor_id GUC so audit events still carry the real actor.
-- User JWTs always have auth.uid() set, so a member can never reach the
-- trusted path; anon callers have no EXECUTE grant at all.
-- ============================================================================
drop function if exists public.admin_action(text, uuid, uuid, uuid, jsonb);
create or replace function public.admin_action(
  p_action text,
  p_target_user_id uuid default null,
  p_team_id uuid default null,
  p_member_id uuid default null,
  p_payload jsonb default '{}'::jsonb,
  p_actor_id uuid default null
)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_is_admin boolean;
  v_member public.team_members;
  v_team_name text;
  v_team_id uuid;
  v_actor uuid;
begin
  if auth.uid() is not null then
    select coalesce(is_platform_admin, false) into v_is_admin
      from public.profiles where id = auth.uid();
    if not v_is_admin then
      return jsonb_build_object('ok', false, 'error', 'FORBIDDEN');
    end if;
    v_actor := auth.uid();
  else
    -- Trusted-server path: only the service-role role (or a direct DB
    -- connection) can be here — anon JWTs have no EXECUTE grant and user
    -- JWTs always carry a sub claim.
    if coalesce(auth.role(), '') = 'anon' then
      return jsonb_build_object('ok', false, 'error', 'FORBIDDEN');
    end if;
    v_actor := p_actor_id;
  end if;

  -- Transaction-scoped: triggers prefer auth.uid() when present, so this can
  -- never be abused to forge another actor from a user session.
  perform set_config('app.actor_id', coalesce(v_actor::text, ''), true);

  case p_action
    when 'approve_user' then
      update public.profiles
         set status = 'approved', approved_at = now(), approved_by = coalesce(v_actor, auth.uid())
       where id = p_target_user_id and status in ('pending', 'suspended', 'rejected');
      if not found then
        return jsonb_build_object('ok', false, 'error', 'NOT_FOUND_OR_INVALID_STATE');
      end if;
      perform public.notify_user(p_target_user_id, 'Account approved',
        'Your account has been approved. You can now log in.', 'success', '/dashboard');

    when 'reject_user' then
      update public.profiles
         set status = 'rejected', rejected_at = now(), rejected_by = coalesce(v_actor, auth.uid())
       where id = p_target_user_id and status = 'pending';
      if not found then
        return jsonb_build_object('ok', false, 'error', 'NOT_FOUND_OR_INVALID_STATE');
      end if;

    when 'suspend_user' then
      update public.profiles
         set status = 'suspended', suspended_at = now(), suspended_by = coalesce(v_actor, auth.uid())
       where id = p_target_user_id and status = 'approved';
      if not found then
        return jsonb_build_object('ok', false, 'error', 'NOT_FOUND_OR_INVALID_STATE');
      end if;
      perform public.notify_user(p_target_user_id, 'Account suspended',
        'Your account has been suspended by an administrator.', 'error', null);

    when 'reactivate_user' then
      update public.profiles
         set status = 'approved', suspended_at = null, suspended_by = null
       where id = p_target_user_id and status = 'suspended';
      if not found then
        return jsonb_build_object('ok', false, 'error', 'NOT_FOUND_OR_INVALID_STATE');
      end if;
      perform public.notify_user(p_target_user_id, 'Account reactivated',
        'Your account has been reactivated. Welcome back!', 'success', '/dashboard');

    when 'archive_user' then
      update public.profiles set status = 'archived'
       where id = p_target_user_id and status <> 'archived';
      if not found then
        return jsonb_build_object('ok', false, 'error', 'NOT_FOUND_OR_INVALID_STATE');
      end if;

    when 'set_admin' then
      if p_target_user_id = auth.uid() then
        return jsonb_build_object('ok', false, 'error', 'CANNOT_CHANGE_SELF');
      end if;
      update public.profiles
         set is_platform_admin = coalesce((p_payload->>'is_admin')::boolean, false)
       where id = p_target_user_id;
      if not found then
        return jsonb_build_object('ok', false, 'error', 'NOT_FOUND');
      end if;

    when 'create_team' then
      insert into public.teams (name, description, status, created_by)
      values (
        p_payload->>'name',
        nullif(p_payload->>'description', ''),
        coalesce(p_payload->>'status', 'open'),
        coalesce(v_actor, auth.uid())
      )
      returning id into v_team_id;
      return jsonb_build_object('ok', true, 'id', v_team_id);

    when 'rename_team' then
      update public.teams
         set name = coalesce(p_payload->>'name', name)
       where id = p_team_id;
      if not found then
        return jsonb_build_object('ok', false, 'error', 'NOT_FOUND');
      end if;

    when 'archive_team' then
      update public.teams
         set status = 'archived', archived_at = now(), sheet_locked = true
       where id = p_team_id and status <> 'archived';
      if not found then
        return jsonb_build_object('ok', false, 'error', 'NOT_FOUND_OR_INVALID_STATE');
      end if;

    when 'restore_team' then
      update public.teams
         set status = 'open', archived_at = null
       where id = p_team_id and status = 'archived';
      if not found then
        return jsonb_build_object('ok', false, 'error', 'NOT_FOUND_OR_INVALID_STATE');
      end if;

    when 'set_team_status' then
      if coalesce(p_payload->>'status', '') not in ('draft','open','locked','archived') then
        return jsonb_build_object('ok', false, 'error', 'INVALID_STATUS');
      end if;
      update public.teams
         set status = p_payload->>'status',
             archived_at = case when p_payload->>'status' = 'archived' then now() else archived_at end
       where id = p_team_id;
      if not found then
        return jsonb_build_object('ok', false, 'error', 'NOT_FOUND');
      end if;

    when 'lock_sheet' then
      update public.teams set sheet_locked = true where id = p_team_id;
      if not found then
        return jsonb_build_object('ok', false, 'error', 'NOT_FOUND');
      end if;

    when 'unlock_sheet' then
      update public.teams set sheet_locked = false where id = p_team_id;
      if not found then
        return jsonb_build_object('ok', false, 'error', 'NOT_FOUND');
      end if;

    when 'add_member' then
      select * into v_member from public.team_members
        where team_id = p_team_id and user_id = p_target_user_id;
      if found then
        return jsonb_build_object('ok', false, 'error', 'ALREADY_MEMBER');
      end if;
      if not exists (select 1 from public.profiles where id = p_target_user_id) then
        return jsonb_build_object('ok', false, 'error', 'USER_NOT_FOUND');
      end if;
      if not exists (
        select 1 from public.profiles
         where id = p_target_user_id and status = 'approved'
      ) then
        return jsonb_build_object('ok', false, 'error', 'USER_NOT_APPROVED');
      end if;
      insert into public.team_members (team_id, user_id, role, added_by)
      values (p_team_id, p_target_user_id, coalesce(p_payload->>'role', 'DPS'), coalesce(v_actor, auth.uid()));
      return jsonb_build_object('ok', true, 'id',
        (select id from public.team_members where team_id = p_team_id and user_id = p_target_user_id));

    when 'remove_member' then
      delete from public.team_members where id = p_member_id;
      if not found then
        return jsonb_build_object('ok', false, 'error', 'NOT_FOUND');
      end if;

    when 'set_member_role' then
      if coalesce(p_payload->>'role', '') not in ('Tank','Healer','DPS','Support','Leader') then
        return jsonb_build_object('ok', false, 'error', 'INVALID_ROLE');
      end if;
      update public.team_members
         set role = p_payload->>'role'
       where id = p_member_id;
      if not found then
        return jsonb_build_object('ok', false, 'error', 'NOT_FOUND');
      end if;

    else
      return jsonb_build_object('ok', false, 'error', 'UNKNOWN_ACTION');
  end case;

  return jsonb_build_object('ok', true);
end;
$$;

revoke all on function public.admin_action(text, uuid, uuid, uuid, jsonb, uuid) from public, anon;
grant execute on function public.admin_action(text, uuid, uuid, uuid, jsonb, uuid) to authenticated, service_role;

-- ============================================================================
-- ROW LEVEL SECURITY
-- ============================================================================

alter table public.profiles enable row level security;
alter table public.teams enable row level security;
alter table public.team_members enable row level security;
alter table public.notifications enable row level security;
alter table public.audit_logs enable row level security;

-- ----------------------------------------------------------------------------
-- DESIGN RULES (the 42P17 fix)
--
-- * No policy may query the table it protects DIRECTLY (invoker rights).
--   All self-table and cross-table authorization checks go through the
--   security-definer helpers above, which evaluate as the owner and
--   therefore do not re-enter RLS. This is what eliminates
--   "42P17: infinite recursion detected in policy for relation".
-- * Every operation gets its own policy — never one broad policy.
-- * Protected tables have no client INSERT/UPDATE/DELETE policies unless
--   explicitly intended; privileged writes flow through security-definer
--   RPCs that re-verify permissions inside the database.
-- ----------------------------------------------------------------------------

-- ---------- profiles ----------
-- Readable: your own row, admins, and teammates (the sheet joins profiles
-- for IGNs). Never world-readable.
drop policy if exists "profiles: read own, admins or teammates" on public.profiles;
create policy "profiles: read own, admins or teammates"
  on public.profiles for select
  using (
    id = auth.uid()
    or public.is_platform_admin()
    or public.shares_team_with_me(id)
  );

-- Insert: only your own row, and only as a plain pending, non-admin profile.
-- (The signup trigger is the real creator; this guards against abuse.)
drop policy if exists "profiles: insert own pending" on public.profiles;
create policy "profiles: insert own pending"
  on public.profiles for insert
  with check (
    id = auth.uid()
    and is_platform_admin = false
    and status = 'pending'
  );

-- Update: your own row (the trigger + column grants still block status and
-- admin fields) or administrators.
drop policy if exists "profiles: update own or admin" on public.profiles;
create policy "profiles: update own or admin"
  on public.profiles for update
  using (id = auth.uid() or public.is_platform_admin())
  with check (id = auth.uid() or public.is_platform_admin());

-- No delete policy: profiles are never deleted through the client API.

-- ---------- teams ----------
drop policy if exists "teams: members and admins read" on public.teams;
create policy "teams: members and admins read"
  on public.teams for select
  using (public.is_platform_admin() or public.is_team_member(id));

drop policy if exists "teams: admins insert" on public.teams;
create policy "teams: admins insert"
  on public.teams for insert
  with check (public.is_platform_admin());

drop policy if exists "teams: admins update" on public.teams;
create policy "teams: admins update"
  on public.teams for update
  using (public.is_platform_admin())
  with check (public.is_platform_admin());

drop policy if exists "teams: admins delete" on public.teams;
create policy "teams: admins delete"
  on public.teams for delete
  using (public.is_platform_admin());

-- ---------- team_members ----------
drop policy if exists "team_members: team members and admins read" on public.team_members;
create policy "team_members: team members and admins read"
  on public.team_members for select
  using (
    public.is_platform_admin()
    or user_id = auth.uid()
    or public.is_team_member(team_id)
  );

drop policy if exists "team_members: admins insert" on public.team_members;
create policy "team_members: admins insert"
  on public.team_members for insert
  with check (public.is_platform_admin());

-- Members may update only their own row, and only while the sheet is
-- editable. Column grants (below) restrict which fields; the
-- update_member_field RPC is the primary path and re-checks everything.
drop policy if exists "team_members: own row update on editable sheets" on public.team_members;
create policy "team_members: own row update on editable sheets"
  on public.team_members for update
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
  using (public.is_platform_admin());

-- ---------- notifications ----------
drop policy if exists "notifications: read own" on public.notifications;
create policy "notifications: read own"
  on public.notifications for select
  using (user_id = auth.uid());

drop policy if exists "notifications: update own" on public.notifications;
create policy "notifications: update own"
  on public.notifications for update
  using (user_id = auth.uid())
  with check (user_id = auth.uid());

-- ---------- audit_logs ----------
-- Append-only and admin-readable. Members read their own recent events
-- through the recent_own_activity() RPC instead of the table itself.
drop policy if exists "audit_logs: admins read" on public.audit_logs;
create policy "audit_logs: admins read"
  on public.audit_logs for select
  using (public.is_platform_admin());

-- No insert/update/delete policies anywhere: writes happen via triggers,
-- security-definer RPCs, or the server-side service-role client only.

-- ============================================================================
-- GRANTS: tighten default privileges
-- (RLS limits *which rows*; these grants limit *which tables and columns*
-- the anon and authenticated roles can touch at all.)
-- ============================================================================
revoke all on public.profiles from anon;
grant select on public.profiles to authenticated;
grant update (ign, discord) on public.profiles to authenticated;

grant select on public.teams to authenticated;

grant select on public.team_members to authenticated;
grant update (role, weapon, availability, notes) on public.team_members to authenticated;

grant select on public.notifications to authenticated;
grant update (read) on public.notifications to authenticated;

grant select on public.audit_logs to authenticated;

-- ============================================================================
-- DONE
-- ============================================================================
