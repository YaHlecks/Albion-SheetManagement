-- ============================================================================
-- 0004 — ALBION MASS SHEETS
--        sheet (mass) → parties → slots (role/build) → assignments (IGN)
--
-- Design rules inherited from 0001/0003 (DO NOT regress):
--   * RLS enabled on every table; anon keeps ZERO table access.
--   * No policy queries its own table → no 42P17 recursion. Cross-table
--     visibility checks go through security-definer helpers.
--   * Members get SELECT grants only; ALL writes (structure + assignments)
--     flow through security-definer RPCs that re-verify identity and state
--     inside the database. Grant + policy + RPC = three independent gates.
--   * Every mutating RPC writes audit rows; members can never forge them.
-- ============================================================================

-- ----------------------------------------------------------------------------
-- 1. TABLES
-- ----------------------------------------------------------------------------

-- The mass itself (one scheduled Albion mass for one team).
create table if not exists public.mass_sheets (
  id uuid primary key default gen_random_uuid(),
  team_id uuid not null references public.teams(id) on delete cascade,
  title text not null check (char_length(title) between 2 and 120),
  location text check (location is null or char_length(location) <= 120),
  set_name text check (set_name is null or char_length(set_name) <= 60),
  -- Real timestamp (sortable/queryable). Client converts date+time+tz → UTC.
  mass_at timestamptz,
  timezone text check (timezone is null or char_length(timezone) <= 60),
  description text check (description is null or char_length(description) <= 1000),
  instructions text check (instructions is null or char_length(instructions) <= 2000),
  status text not null default 'draft'
    check (status in ('draft','published','locked','archived')),
  created_by uuid references public.profiles(id),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index if not exists mass_sheets_team_idx on public.mass_sheets (team_id, status);
create index if not exists mass_sheets_mass_at_idx on public.mass_sheets (mass_at);

-- Parties inside a mass ("Party 1", "Priority Tanks", …).
create table if not exists public.mass_parties (
  id uuid primary key default gen_random_uuid(),
  sheet_id uuid not null references public.mass_sheets(id) on delete cascade,
  name text not null check (char_length(name) between 1 and 80),
  fill_note text check (fill_note is null or char_length(fill_note) <= 200),
  sort_order integer not null default 0
);

create index if not exists mass_parties_sheet_idx on public.mass_parties (sheet_id, sort_order);

-- A required role/build slot inside a party.
create table if not exists public.mass_slots (
  id uuid primary key default gen_random_uuid(),
  party_id uuid not null references public.mass_parties(id) on delete cascade,
  role text not null check (char_length(role) between 1 and 40),
  build_name text not null check (char_length(build_name) between 1 and 80),
  priority text not null default 'normal'
    check (priority in ('high','normal','low')),
  notes text check (notes is null or char_length(notes) <= 200),
  required boolean not null default true,
  sort_order integer not null default 0
);

create index if not exists mass_slots_party_idx on public.mass_slots (party_id, sort_order);

-- Who fills a slot. ONE active assignment per slot — enforced by the unique
-- constraint below, which is what makes concurrent claims race-safe at the
-- storage layer (the claim RPC additionally returns a friendly error).
create table if not exists public.mass_assignments (
  id uuid primary key default gen_random_uuid(),
  slot_id uuid not null unique references public.mass_slots(id) on delete cascade,
  user_id uuid not null references public.profiles(id) on delete cascade,
  ign text not null check (char_length(ign) between 2 and 32),
  assigned_at timestamptz not null default now(),
  assigned_by uuid references public.profiles(id)
);

create index if not exists mass_assignments_user_idx on public.mass_assignments (user_id);

-- ----------------------------------------------------------------------------
-- 2. HELPERS (security definer → evaluated as owner, 42P17-safe)
-- ----------------------------------------------------------------------------

-- Can the current user SEE the given sheet? Admin: always. Member: team member
-- and the sheet is not a draft (drafts are admin-only until published).
create or replace function public.is_mass_sheet_visible(p_sheet_id uuid)
returns boolean
language sql
security definer
set search_path = public
stable
as $$
  select exists (
    select 1 from public.mass_sheets s
    where s.id = p_sheet_id
      and (
        coalesce((select p.is_platform_admin from public.profiles p where p.id = auth.uid()), false)
        or (
          exists (select 1 from public.team_members tm
                  where tm.team_id = s.team_id and tm.user_id = auth.uid())
          and s.status <> 'draft'
        )
      )
  );
$$;

-- Party visible when its sheet is visible.
create or replace function public.is_mass_party_visible(p_party_id uuid)
returns boolean
language sql
security definer
set search_path = public
stable
as $$
  select exists (
    select 1 from public.mass_parties mp
    where mp.id = p_party_id
      and public.is_mass_sheet_visible(mp.sheet_id)
  );
$$;

-- Slot visible when its party is visible.
create or replace function public.is_mass_slot_visible(p_slot_id uuid)
returns boolean
language sql
security definer
set search_path = public
stable
as $$
  select exists (
    select 1 from public.mass_slots ms
    join public.mass_parties mp on mp.id = ms.party_id
    where ms.id = p_slot_id
      and public.is_mass_sheet_visible(mp.sheet_id)
  );
$$;

-- ----------------------------------------------------------------------------
-- 3. RPCs — member claim / unclaim (concurrency-safe)
-- ----------------------------------------------------------------------------

-- Claim a slot. The UNIQUE(slot_id) constraint is the race-decider: two
-- simultaneous claims cannot both commit; the loser gets unique_violation,
-- surfaced as SLOT_TAKEN. Identity always comes from auth.uid().
create or replace function public.claim_mass_slot(p_slot_id uuid, p_ign text)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_slot record;
  v_ign text;
  v_admin boolean;
  v_member boolean;
  v_sheet record;
begin
  if auth.uid() is null then
    return jsonb_build_object('ok', false, 'error', 'UNAUTHENTICATED');
  end if;

  v_ign := nullif(trim(p_ign), '');
  if v_ign is null or char_length(v_ign) < 2 or char_length(v_ign) > 32 then
    return jsonb_build_object('ok', false, 'error', 'INVALID_IGN');
  end if;

  select ms.id, ms.party_id, ms.role, ms.build_name,
         mp.sheet_id
    into v_slot
  from public.mass_slots ms
  join public.mass_parties mp on mp.id = ms.party_id
  where ms.id = p_slot_id;
  if not found then
    return jsonb_build_object('ok', false, 'error', 'SLOT_NOT_FOUND');
  end if;

  select * into v_sheet from public.mass_sheets where id = v_slot.sheet_id;

  v_admin := coalesce(
    (select p.is_platform_admin from public.profiles p where p.id = auth.uid()), false);
  v_member := exists (
    select 1 from public.team_members tm
    where tm.team_id = v_sheet.team_id and tm.user_id = auth.uid());

  if not v_admin and not v_member then
    return jsonb_build_object('ok', false, 'error', 'NOT_TEAM_MEMBER');
  end if;

  if coalesce(
    (select p.status from public.profiles p where p.id = auth.uid()), 'pending') <> 'approved' then
    return jsonb_build_object('ok', false, 'error', 'ACCOUNT_NOT_APPROVED');
  end if;

  -- Only a PUBLISHED sheet accepts claims (locked/archived/draft reject).
  if v_sheet.status <> 'published' then
    return jsonb_build_object('ok', false, 'error', 'SHEET_NOT_OPEN');
  end if;

  -- Already taken by someone else?
  if exists (
    select 1 from public.mass_assignments ma
    where ma.slot_id = p_slot_id and ma.user_id <> auth.uid()
  ) then
    return jsonb_build_object('ok', false, 'error', 'SLOT_TAKEN');
  end if;

  begin
    insert into public.mass_assignments (slot_id, user_id, ign, assigned_by)
    values (p_slot_id, auth.uid(), v_ign, auth.uid())
    on conflict (slot_id) do update
      set ign = excluded.ign, assigned_at = now()
      where mass_assignments.user_id = auth.uid();   -- re-claim of own slot updates IGN

    -- Race guard: if a concurrent user claimed between the pre-check and the
    -- insert, the ON CONFLICT DO UPDATE ... WHERE matches nothing and the
    -- statement is a silent no-op. Verify we actually hold the slot.
    if not exists (
      select 1 from public.mass_assignments
      where slot_id = p_slot_id and user_id = auth.uid()
    ) then
      return jsonb_build_object('ok', false, 'error', 'SLOT_TAKEN');
    end if;

    insert into public.audit_logs (action, actor_id, target_user_id, team_id, meta)
    values ('MEMBER_ASSIGNED', auth.uid(), auth.uid(), v_sheet.team_id,
      jsonb_build_object(
        'sheet_id', v_sheet.id, 'sheet_title', v_sheet.title,
        'slot_id', p_slot_id, 'role', v_slot.role, 'build', v_slot.build_name,
        'ign', v_ign));
  exception when unique_violation then
    -- Lost the race: another user committed first.
    return jsonb_build_object('ok', false, 'error', 'SLOT_TAKEN');
  end;

  return jsonb_build_object('ok', true);
end;
$$;

-- Unclaim own slot (published sheets only).
create or replace function public.unclaim_mass_slot(p_slot_id uuid)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_slot record;
  v_sheet record;
  v_old text;
begin
  if auth.uid() is null then
    return jsonb_build_object('ok', false, 'error', 'UNAUTHENTICATED');
  end if;

  select ms.party_id, mp.sheet_id into v_slot
  from public.mass_slots ms
  join public.mass_parties mp on mp.id = ms.party_id
  where ms.id = p_slot_id;
  if not found then
    return jsonb_build_object('ok', false, 'error', 'SLOT_NOT_FOUND');
  end if;

  select * into v_sheet from public.mass_sheets where id = v_slot.sheet_id;
  if v_sheet.status <> 'published' then
    return jsonb_build_object('ok', false, 'error', 'SHEET_NOT_OPEN');
  end if;

  delete from public.mass_assignments
  where slot_id = p_slot_id and user_id = auth.uid()
  returning ign into v_old;

  if v_old is null then
    return jsonb_build_object('ok', false, 'error', 'NOT_CLAIMED_BY_YOU');
  end if;

  insert into public.audit_logs (action, actor_id, target_user_id, team_id, meta)
  values ('MEMBER_UNASSIGNED', auth.uid(), auth.uid(), v_sheet.team_id,
    jsonb_build_object(
      'sheet_id', v_sheet.id, 'sheet_title', v_sheet.title,
      'slot_id', p_slot_id, 'ign', v_old));

  return jsonb_build_object('ok', true);
end;
$$;

-- ----------------------------------------------------------------------------
-- 4. RPCs — admin structure management
-- ----------------------------------------------------------------------------

-- Save a whole sheet (create or update) in ONE call: header + parties + slots.
-- p_data.parties[i].slots[j] may carry "id" (existing slot → update in place,
-- assignments preserved) or omit it (new slot). Missing ids are deleted —
-- the UI warns before removing slots that hold assignments.
create or replace function public.save_mass_sheet(
  p_sheet_id uuid,
  p_data jsonb
)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_admin boolean;
  v_actor uuid := auth.uid();
  v_sheet_id uuid := p_sheet_id;
  v_is_new boolean := false;
  v_party jsonb;
  v_slot jsonb;
  v_party_id uuid;
  v_slot_id uuid;
  v_kept_slot_ids uuid[] := '{}';
  v_kept_party_ids uuid[] := '{}';
  v_team_id uuid;
  v_prev_status text;
begin
  if v_actor is null then
    return jsonb_build_object('ok', false, 'error', 'UNAUTHENTICATED');
  end if;
  select coalesce(is_platform_admin, false) into v_admin
    from public.profiles where id = v_actor;
  if not v_admin then
    return jsonb_build_object('ok', false, 'error', 'FORBIDDEN');
  end if;

  v_team_id := nullif(p_data->>'team_id', '')::uuid;
  if v_team_id is null or not exists (select 1 from public.teams where id = v_team_id) then
    return jsonb_build_object('ok', false, 'error', 'TEAM_NOT_FOUND');
  end if;

  if p_sheet_id is null then
    insert into public.mass_sheets (team_id, title, created_by)
    values (v_team_id, 'Untitled mass', v_actor)
    returning id into v_sheet_id;
    v_is_new := true;
    insert into public.audit_logs (action, actor_id, team_id, meta)
    values ('SHEET_CREATED', v_actor, v_team_id, jsonb_build_object('sheet_id', v_sheet_id));
  else
    select status into v_prev_status from public.mass_sheets where id = p_sheet_id;
    if not found then
      return jsonb_build_object('ok', false, 'error', 'SHEET_NOT_FOUND');
    end if;
  end if;

  -- Header ------------------------------------------------------------------
  update public.mass_sheets set
    title        = coalesce(nullif(trim(p_data->>'title'), ''), title),
    location     = nullif(trim(p_data->>'location'), ''),
    set_name     = nullif(trim(p_data->>'set_name'), ''),
    mass_at      = nullif(p_data->>'mass_at', '')::timestamptz,
    timezone     = nullif(trim(p_data->>'timezone'), ''),
    description  = nullif(p_data->>'description', ''),
    instructions = nullif(p_data->>'instructions', ''),
    team_id      = v_team_id,
    updated_at   = now()
  where id = v_sheet_id;

  -- Parties + slots ----------------------------------------------------------
  for v_party in select * from jsonb_array_elements(coalesce(p_data->'parties', '[]'::jsonb))
  loop
    v_party_id := nullif(v_party->>'id', '')::uuid;

    if v_party_id is null then
      insert into public.mass_parties (sheet_id, name, fill_note, sort_order)
      values (v_sheet_id,
              coalesce(nullif(trim(v_party->>'name'), ''), 'Party'),
              nullif(trim(coalesce(v_party->>'fill_note', '')), ''),
              coalesce((v_party->>'sort_order')::int, 0))
      returning id into v_party_id;
    else
      update public.mass_parties set
        name = coalesce(nullif(trim(v_party->>'name'), ''), name),
        fill_note = nullif(trim(coalesce(v_party->>'fill_note', '')), ''),
        sort_order = coalesce((v_party->>'sort_order')::int, sort_order)
      where id = v_party_id and sheet_id = v_sheet_id;
      if not found then
        -- party id does not belong to this sheet → treat as new
        insert into public.mass_parties (sheet_id, name, fill_note, sort_order)
        values (v_sheet_id,
                coalesce(nullif(trim(v_party->>'name'), ''), 'Party'),
                nullif(trim(coalesce(v_party->>'fill_note', '')), ''),
                coalesce((v_party->>'sort_order')::int, 0))
        returning id into v_party_id;
      end if;
    end if;
    v_kept_party_ids := array_append(v_kept_party_ids, v_party_id);

    for v_slot in select * from jsonb_array_elements(coalesce(v_party->'slots', '[]'::jsonb))
    loop
      v_slot_id := nullif(v_slot->>'id', '')::uuid;

      if v_slot_id is null then
        insert into public.mass_slots (party_id, role, build_name, priority, notes, required, sort_order)
        values (v_party_id,
                coalesce(nullif(trim(v_slot->>'role'), ''), 'Fill'),
                coalesce(nullif(trim(v_slot->>'build_name'), ''), 'TBD'),
                coalesce(v_slot->>'priority', 'normal'),
                nullif(trim(coalesce(v_slot->>'notes', '')), ''),
                coalesce((v_slot->>'required')::boolean, true),
                coalesce((v_slot->>'sort_order')::int, 0))
        returning id into v_slot_id;
      else
        update public.mass_slots set
          role = coalesce(nullif(trim(v_slot->>'role'), ''), role),
          build_name = coalesce(nullif(trim(v_slot->>'build_name'), ''), build_name),
          priority = coalesce(v_slot->>'priority', priority),
          notes = nullif(trim(coalesce(v_slot->>'notes', '')), ''),
          required = coalesce((v_slot->>'required')::boolean, required),
          sort_order = coalesce((v_slot->>'sort_order')::int, sort_order)
        where id = v_slot_id
          and party_id in (select id from public.mass_parties where sheet_id = v_sheet_id);
        if not found then
          insert into public.mass_slots (party_id, role, build_name, priority, notes, required, sort_order)
          values (v_party_id,
                  coalesce(nullif(trim(v_slot->>'role'), ''), 'Fill'),
                  coalesce(nullif(trim(v_slot->>'build_name'), ''), 'TBD'),
                  coalesce(v_slot->>'priority', 'normal'),
                  nullif(trim(coalesce(v_slot->>'notes', '')), ''),
                  coalesce((v_slot->>'required')::boolean, true),
                  coalesce((v_slot->>'sort_order')::int, 0))
          returning id into v_slot_id;
        end if;
      end if;
      v_kept_slot_ids := array_append(v_kept_slot_ids, v_slot_id);
    end loop;
  end loop;

  -- Delete removed slots/parties (cascades assignments with them).
  delete from public.mass_slots
   where party_id in (select id from public.mass_parties where sheet_id = v_sheet_id)
     and not (id = any(v_kept_slot_ids));
  delete from public.mass_parties
   where sheet_id = v_sheet_id and not (id = any(v_kept_party_ids));

  insert into public.audit_logs (action, actor_id, team_id, meta)
  select 'SHEET_UPDATED', v_actor, m.team_id,
    jsonb_build_object('sheet_id', m.id, 'title', m.title, 'was_new', v_is_new)
  from public.mass_sheets m where m.id = v_sheet_id;

  return jsonb_build_object('ok', true, 'id', v_sheet_id, 'created', v_is_new);
end;
$$;

-- Duplicate a sheet: structure only, never assignments (§26).
create or replace function public.duplicate_mass_sheet(p_sheet_id uuid)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_admin boolean;
  v_actor uuid := auth.uid();
  v_src public.mass_sheets;
  v_new_id uuid;
  v_party record;
  v_slot record;
  v_new_party uuid;
begin
  select coalesce(is_platform_admin, false) into v_admin
    from public.profiles where id = v_actor;
  if not v_admin then
    return jsonb_build_object('ok', false, 'error', 'FORBIDDEN');
  end if;

  select * into v_src from public.mass_sheets where id = p_sheet_id;
  if not found then
    return jsonb_build_object('ok', false, 'error', 'SHEET_NOT_FOUND');
  end if;

  insert into public.mass_sheets (team_id, title, location, set_name, mass_at, timezone,
                                  description, instructions, status, created_by)
  values (v_src.team_id,
          left(v_src.title || ' (copy)', 120),
          v_src.location, v_src.set_name, null, v_src.timezone,
          v_src.description, v_src.instructions, 'draft', v_actor)
  returning id into v_new_id;

  for v_party in select * from public.mass_parties where sheet_id = v_src.id order by sort_order
  loop
    insert into public.mass_parties (sheet_id, name, fill_note, sort_order)
    values (v_new_id, v_party.name, v_party.fill_note, v_party.sort_order)
    returning id into v_new_party;

    for v_slot in select * from public.mass_slots where party_id = v_party.id order by sort_order
    loop
      insert into public.mass_slots (party_id, role, build_name, priority, notes, required, sort_order)
      values (v_new_party, v_slot.role, v_slot.build_name, v_slot.priority, v_slot.notes,
              v_slot.required, v_slot.sort_order);
    end loop;
  end loop;

  insert into public.audit_logs (action, actor_id, team_id, meta)
  values ('SHEET_DUPLICATED', v_actor, v_src.team_id,
    jsonb_build_object('source_id', v_src.id, 'new_id', v_new_id));

  return jsonb_build_object('ok', true, 'id', v_new_id);
end;
$$;

-- Lifecycle: publish / lock / unlock / archive / restore (§25).
create or replace function public.set_mass_sheet_status(p_sheet_id uuid, p_status text)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_admin boolean;
  v_actor uuid := auth.uid();
  v_sheet public.mass_sheets;
begin
  select coalesce(is_platform_admin, false) into v_admin
    from public.profiles where id = v_actor;
  if not v_admin then
    return jsonb_build_object('ok', false, 'error', 'FORBIDDEN');
  end if;

  if p_status not in ('draft','published','locked','archived') then
    return jsonb_build_object('ok', false, 'error', 'INVALID_STATUS');
  end if;

  select * into v_sheet from public.mass_sheets where id = p_sheet_id;
  if not found then
    return jsonb_build_object('ok', false, 'error', 'SHEET_NOT_FOUND');
  end if;
  if v_sheet.status = p_status then
    return jsonb_build_object('ok', true);
  end if;

  update public.mass_sheets set status = p_status, updated_at = now()
  where id = p_sheet_id;

  insert into public.audit_logs (action, actor_id, team_id, meta)
  values (
    case p_status
      when 'published' then 'SHEET_PUBLISHED'
      when 'locked'    then 'SHEET_LOCKED'
      when 'archived'  then 'SHEET_ARCHIVED'
      else 'SHEET_RESTORED'
    end,
    v_actor, v_sheet.team_id,
    jsonb_build_object('sheet_id', v_sheet.id, 'previous_status', v_sheet.status, 'new_status', p_status));

  return jsonb_build_object('ok', true);
end;
$$;

-- Admin (re)assign a slot to any approved team member, or clear it.
create or replace function public.admin_set_slot_assignment(
  p_slot_id uuid,
  p_user_id uuid,      -- null clears the assignment
  p_ign text default null
)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_admin boolean;
  v_actor uuid := auth.uid();
  v_slot record;
  v_sheet record;
  v_old record;
  v_new_ign text;
begin
  select coalesce(is_platform_admin, false) into v_admin
    from public.profiles where id = v_actor;
  if not v_admin then
    return jsonb_build_object('ok', false, 'error', 'FORBIDDEN');
  end if;

  select ms.id, ms.party_id, ms.role, ms.build_name, mp.sheet_id
    into v_slot
  from public.mass_slots ms
  join public.mass_parties mp on mp.id = ms.party_id
  where ms.id = p_slot_id;
  if not found then
    return jsonb_build_object('ok', false, 'error', 'SLOT_NOT_FOUND');
  end if;
  select * into v_sheet from public.mass_sheets where id = v_slot.sheet_id;

  select * into v_old from public.mass_assignments where slot_id = p_slot_id;

  if p_user_id is null then
    if v_old is null then
      return jsonb_build_object('ok', true);
    end if;
    delete from public.mass_assignments where slot_id = p_slot_id;
    insert into public.audit_logs (action, actor_id, target_user_id, team_id, meta)
    values ('MEMBER_UNASSIGNED', v_actor, v_old.user_id, v_sheet.team_id,
      jsonb_build_object('sheet_id', v_sheet.id, 'slot_id', p_slot_id, 'ign', v_old.ign, 'by_admin', true));
    return jsonb_build_object('ok', true);
  end if;

  if not exists (
    select 1 from public.profiles where id = p_user_id and status = 'approved'
  ) then
    return jsonb_build_object('ok', false, 'error', 'USER_NOT_APPROVED');
  end if;

  v_new_ign := coalesce(nullif(trim(p_ign), ''),
    (select ign from public.profiles where id = p_user_id));
  if v_new_ign is null then
    return jsonb_build_object('ok', false, 'error', 'NO_IGN');
  end if;

  insert into public.mass_assignments (slot_id, user_id, ign, assigned_by)
  values (p_slot_id, p_user_id, v_new_ign, v_actor)
  on conflict (slot_id) do update
    set user_id = excluded.user_id, ign = excluded.ign, assigned_at = now(), assigned_by = excluded.assigned_by;

  if v_old is not null and v_old.user_id <> p_user_id then
    insert into public.audit_logs (action, actor_id, target_user_id, team_id, meta)
    values ('MEMBER_MOVED', v_actor, p_user_id, v_sheet.team_id,
      jsonb_build_object('sheet_id', v_sheet.id, 'slot_id', p_slot_id,
                         'previous_user', v_old.user_id, 'previous_ign', v_old.ign, 'ign', v_new_ign));
  else
    insert into public.audit_logs (action, actor_id, target_user_id, team_id, meta)
    values ('MEMBER_ASSIGNED', v_actor, p_user_id, v_sheet.team_id,
      jsonb_build_object('sheet_id', v_sheet.id, 'slot_id', p_slot_id,
                         'build', v_slot.build_name, 'ign', v_new_ign, 'by_admin', true));
  end if;

  return jsonb_build_object('ok', true);
end;
$$;

-- ----------------------------------------------------------------------------
-- 5. GRANTS (§23: policy alone never replaces the table privilege)
-- ----------------------------------------------------------------------------
revoke all on public.mass_sheets      from anon;
revoke all on public.mass_parties     from anon;
revoke all on public.mass_slots       from anon;
revoke all on public.mass_assignments from anon;

-- authenticated: SELECT only — every write goes through the definer RPCs.
grant select on public.mass_sheets      to authenticated;
grant select on public.mass_parties     to authenticated;
grant select on public.mass_slots       to authenticated;
grant select on public.mass_assignments to authenticated;

revoke insert, update, delete, truncate, references, trigger
  on public.mass_sheets, public.mass_parties, public.mass_slots, public.mass_assignments
  from authenticated;

grant select, insert, update, delete
  on public.mass_sheets, public.mass_parties, public.mass_slots, public.mass_assignments
  to service_role;

grant execute on function public.is_mass_sheet_visible(uuid) to anon, authenticated;
grant execute on function public.is_mass_party_visible(uuid) to anon, authenticated;
grant execute on function public.is_mass_slot_visible(uuid)  to anon, authenticated;

grant execute on function public.claim_mass_slot(uuid, text)  to authenticated, service_role;
grant execute on function public.unclaim_mass_slot(uuid)      to authenticated, service_role;
grant execute on function public.save_mass_sheet(uuid, jsonb) to authenticated, service_role;
grant execute on function public.duplicate_mass_sheet(uuid)   to authenticated, service_role;
grant execute on function public.set_mass_sheet_status(uuid, text) to authenticated, service_role;
grant execute on function public.admin_set_slot_assignment(uuid, uuid, text) to authenticated, service_role;

-- ----------------------------------------------------------------------------
-- 6. RLS — enabled everywhere; visibility cascades via definer helpers
-- ----------------------------------------------------------------------------
alter table public.mass_sheets      enable row level security;
alter table public.mass_parties     enable row level security;
alter table public.mass_slots       enable row level security;
alter table public.mass_assignments enable row level security;

-- ---------- mass_sheets ----------
drop policy if exists "mass_sheets: team and admins read" on public.mass_sheets;
create policy "mass_sheets: team and admins read"
  on public.mass_sheets for select
  to authenticated, service_role
  using (public.is_mass_sheet_visible(id));

drop policy if exists "mass_sheets: admins insert" on public.mass_sheets;
create policy "mass_sheets: admins insert"
  on public.mass_sheets for insert
  to authenticated, service_role
  with check (public.is_platform_admin());

drop policy if exists "mass_sheets: admins update" on public.mass_sheets;
create policy "mass_sheets: admins update"
  on public.mass_sheets for update
  to authenticated, service_role
  using (public.is_platform_admin())
  with check (public.is_platform_admin());

drop policy if exists "mass_sheets: admins delete" on public.mass_sheets;
create policy "mass_sheets: admins delete"
  on public.mass_sheets for delete
  to authenticated, service_role
  using (public.is_platform_admin());

-- ---------- mass_parties ----------
drop policy if exists "mass_parties: sheet-visible read" on public.mass_parties;
create policy "mass_parties: sheet-visible read"
  on public.mass_parties for select
  to authenticated, service_role
  using (public.is_mass_party_visible(id));

drop policy if exists "mass_parties: admins all" on public.mass_parties;
create policy "mass_parties: admins all"
  on public.mass_parties for all
  to authenticated, service_role
  using (public.is_platform_admin())
  with check (public.is_platform_admin());

-- ---------- mass_slots ----------
drop policy if exists "mass_slots: party-visible read" on public.mass_slots;
create policy "mass_slots: party-visible read"
  on public.mass_slots for select
  to authenticated, service_role
  using (public.is_mass_slot_visible(id));

drop policy if exists "mass_slots: admins all" on public.mass_slots;
create policy "mass_slots: admins all"
  on public.mass_slots for all
  to authenticated, service_role
  using (public.is_platform_admin())
  with check (public.is_platform_admin());

-- ---------- mass_assignments ----------
-- Read: anyone who can see the sheet (assignments are the public IGN grid).
drop policy if exists "mass_assignments: sheet-visible read" on public.mass_assignments;
create policy "mass_assignments: sheet-visible read"
  on public.mass_assignments for select
  to authenticated, service_role
  using (public.is_mass_slot_visible(slot_id));

-- Members may edit ONLY their own assignment rows, and only while the sheet
-- is published (direct-path fallback; the RPCs are the primary path).
drop policy if exists "mass_assignments: own row on published" on public.mass_assignments;
create policy "mass_assignments: own row on published"
  on public.mass_assignments for all
  to authenticated, service_role
  using (
    user_id = auth.uid()
    and exists (
      select 1
      from public.mass_slots ms
      join public.mass_parties mp on mp.id = ms.party_id
      join public.mass_sheets m on m.id = mp.sheet_id
      where ms.id = slot_id and m.status = 'published'
    )
  )
  with check (
    user_id = auth.uid()
    and exists (
      select 1
      from public.mass_slots ms
      join public.mass_parties mp on mp.id = ms.party_id
      join public.mass_sheets m on m.id = mp.sheet_id
      where ms.id = slot_id and m.status = 'published'
    )
  );

-- No INSERT/UPDATE/DELETE policies for structure tables: admin structure
-- writes flow through save_mass_sheet / set_mass_sheet_status / duplicate RPCs.

-- ----------------------------------------------------------------------------
-- 7. REALTIME — publish assignment + status changes (member live view, §18)
-- ----------------------------------------------------------------------------
do $$
begin
  if exists (select 1 from pg_publication where pubname = 'supabase_realtime') then
    if not exists (
      select 1 from pg_publication_tables
      where pubname = 'supabase_realtime' and schemaname = 'public' and tablename = 'mass_assignments'
    ) then
      alter publication supabase_realtime add table public.mass_assignments;
    end if;
    if not exists (
      select 1 from pg_publication_tables
      where pubname = 'supabase_realtime' and schemaname = 'public' and tablename = 'mass_sheets'
    ) then
      alter publication supabase_realtime add table public.mass_sheets;
    end if;
  end if;
end
$$;

-- ----------------------------------------------------------------------------
-- 8. updated_at trigger
-- ----------------------------------------------------------------------------
create or replace function public.handle_mass_sheet_update()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  new.updated_at := now();
  return new;
end;
$$;

drop trigger if exists on_mass_sheet_update on public.mass_sheets;
create trigger on_mass_sheet_update
  before update on public.mass_sheets
  for each row execute function public.handle_mass_sheet_update();

-- ============================================================================
-- DONE — verify with:  npm run db:doctor && npm run db:push
-- ============================================================================
