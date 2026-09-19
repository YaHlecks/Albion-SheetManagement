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
create index if not exists profiles_ign_idx on public.profiles (lower(ign));

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
  insert into public.notifications (user_id, title, body, type, link)
  values (p_user_id, p_title, p_body, p_type, p_link);
end;
$$;

revoke all on function public.notify_user(uuid, text, text, text, text) from public, anon;
grant execute on function public.notify_user(uuid, text, text, text, text) to authenticated;

-- Security-definer audit writer for sessions without service-role access.
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
begin
  insert into public.audit_logs (action, actor_id, target_user_id, team_id, meta)
  values (p_action, auth.uid(), p_target_user_id, p_team_id, p_meta);
end;
$$;

revoke all on function public.log_audit(text, uuid, uuid, jsonb) from public, anon;
grant execute on function public.log_audit(text, uuid, uuid, jsonb) to authenticated;

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
  profile_count bigint;
begin
  new_ign := nullif(trim(new.raw_user_meta_data->>'ign'), '');
  new_discord := nullif(trim(new.raw_user_meta_data->>'discord'), '');

  if new_ign is null or char_length(new_ign) < 2 or char_length(new_ign) > 32 then
    new_ign := 'player-' || left(new.id::text, 8);
  end if;

  if new_discord is not null and char_length(new_discord) > 64 then
    new_discord := left(new_discord, 64);
  end if;

  select count(*) into profile_count from public.profiles;

  insert into public.profiles (id, ign, discord, status, is_platform_admin)
  values (new.id, new_ign, new_discord, 'pending', (profile_count = 0));

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
-- TRIGGER: login tracking + audit event
-- ============================================================================
create or replace function public.handle_login()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  insert into public.audit_logs (action, actor_id, target_user_id, meta)
  values ('USER_LOGIN', new.id, new.id, jsonb_build_object());
  return new;
end;
$$;

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
  actor uuid := auth.uid();
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
  actor uuid := auth.uid();
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
  actor uuid := auth.uid();
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

create trigger on_membership_insert
  after insert on public.team_members
  for each row execute function public.handle_membership_change();

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
  actor uuid := auth.uid();
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
-- RPC: generic admin actions (used when no service-role key is configured).
-- Verifies the caller is a platform admin INSIDE the function.
-- ============================================================================
create or replace function public.admin_action(
  p_action text,
  p_target_user_id uuid default null,
  p_team_id uuid default null,
  p_member_id uuid default null,
  p_payload jsonb default '{}'::jsonb
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
begin
  select coalesce(is_platform_admin, false) into v_is_admin
    from public.profiles where id = auth.uid();
  if not v_is_admin then
    return jsonb_build_object('ok', false, 'error', 'FORBIDDEN');
  end if;

  case p_action
    when 'approve_user' then
      update public.profiles
         set status = 'approved', approved_at = now(), approved_by = auth.uid()
       where id = p_target_user_id and status in ('pending', 'suspended', 'rejected');
      if not found then
        return jsonb_build_object('ok', false, 'error', 'NOT_FOUND_OR_INVALID_STATE');
      end if;
      perform public.notify_user(p_target_user_id, 'Account approved',
        'Your account has been approved. You can now log in.', 'success', '/dashboard');

    when 'reject_user' then
      update public.profiles
         set status = 'rejected', rejected_at = now(), rejected_by = auth.uid()
       where id = p_target_user_id and status = 'pending';
      if not found then
        return jsonb_build_object('ok', false, 'error', 'NOT_FOUND_OR_INVALID_STATE');
      end if;

    when 'suspend_user' then
      update public.profiles
         set status = 'suspended', suspended_at = now(), suspended_by = auth.uid()
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
      if char_length(coalesce(p_payload->>'name', '')) < 2
         or char_length(coalesce(p_payload->>'name', '')) > 60 then
        return jsonb_build_object('ok', false, 'error', 'INVALID_NAME');
      end if;
      insert into public.teams (name, description, status, created_by)
      values (
        p_payload->>'name',
        nullif(p_payload->>'description', ''),
        coalesce(p_payload->>'status', 'open'),
        auth.uid()
      );
      return jsonb_build_object('ok', true, 'id',
        (select id from public.teams where created_by = auth.uid()
          order by created_at desc limit 1));

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
      values (p_team_id, p_target_user_id, coalesce(p_payload->>'role', 'DPS'), auth.uid());
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

revoke all on function public.admin_action(text, uuid, uuid, uuid, jsonb) from public, anon;
grant execute on function public.admin_action(text, uuid, uuid, uuid, jsonb) to authenticated;

-- ============================================================================
-- ROW LEVEL SECURITY
-- ============================================================================

alter table public.profiles enable row level security;
alter table public.teams enable row level security;
alter table public.team_members enable row level security;
alter table public.notifications enable row level security;
alter table public.audit_logs enable row level security;

-- ---------- profiles ----------
create policy "profiles: read own or admin"
  on public.profiles for select
  using (id = auth.uid() or public.is_platform_admin());

create policy "profiles: insert own on signup"
  on public.profiles for insert
  with check (id = auth.uid());

create policy "profiles: update own or admin"
  on public.profiles for update
  using (id = auth.uid() or public.is_platform_admin());

-- ---------- teams ----------
create policy "teams: members and admins read"
  on public.teams for select
  using (
    public.is_platform_admin()
    or exists (
      select 1 from public.team_members tm
      where tm.team_id = id and tm.user_id = auth.uid()
    )
  );

create policy "teams: admins insert"
  on public.teams for insert
  with check (public.is_platform_admin());

create policy "teams: admins update"
  on public.teams for update
  using (public.is_platform_admin());

create policy "teams: admins delete"
  on public.teams for delete
  using (public.is_platform_admin());

-- ---------- team_members ----------
create policy "team_members: team members and admins read"
  on public.team_members for select
  using (
    public.is_platform_admin()
    or user_id = auth.uid()
    or exists (
      select 1 from public.team_members tm
      where tm.team_id = team_id and tm.user_id = auth.uid()
    )
  );

create policy "team_members: admins insert"
  on public.team_members for insert
  with check (public.is_platform_admin());

create policy "team_members: self update limited fields"
  on public.team_members for update
  using (
    public.is_platform_admin()
    or (
      user_id = auth.uid()
      and exists (
        select 1 from public.teams t
        where t.id = team_id and t.status in ('open','draft') and t.sheet_locked = false
      )
    )
  );

create policy "team_members: admins delete"
  on public.team_members for delete
  using (public.is_platform_admin());

-- ---------- notifications ----------
create policy "notifications: read own"
  on public.notifications for select
  using (user_id = auth.uid());

create policy "notifications: update own"
  on public.notifications for update
  using (user_id = auth.uid());

-- ---------- audit_logs ----------
create policy "audit_logs: admins read"
  on public.audit_logs for select
  using (public.is_platform_admin());

-- No insert/update/delete policies anywhere: writes happen via triggers,
-- security-definer RPCs, or the server-side service-role client only.

-- ============================================================================
-- GRANTS: tighten default privileges
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
