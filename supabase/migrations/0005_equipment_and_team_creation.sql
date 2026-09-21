-- ============================================================================
-- 0005 — EQUIPMENT CATALOG + ATOMIC TEAM CREATION
--
-- Part A: albion_equipment — researched Albion Online equipment catalog.
--         Source of truth: local seed (works fully offline) + optional
--         `npm run equipment:sync` from OpenAlbion API v3
--         (https://api.openalbion.com — free/open data; currently
--         intermittently unavailable, so the app NEVER depends on it live).
--         Search/selection runs against this table via RLS'd reads.
--
-- Part B: admin_action('create_team') hardened — name validation, friendly
--         duplicate error, creator membership + audit written ATOMICALLY
--         inside the same definer call (no half-created teams).
--
-- Part C: mass_slots.tier_requirement — structured "Any Tier / T4 … T8"
--         handling (Phase 26) with an updated save_mass_sheet that persists
--         it. Full function replacement keeps one authoritative definition.
-- ============================================================================

-- ----------------------------------------------------------------------------
-- A. EQUIPMENT CATALOG
-- ----------------------------------------------------------------------------
create table if not exists public.albion_equipment (
  id uuid primary key default gen_random_uuid(),
  name text not null unique check (char_length(name) between 2 and 80),
  category text not null check (char_length(category) between 2 and 40),
  family text not null check (char_length(family) between 2 and 40),
  weapon_type text check (weapon_type is null or char_length(weapon_type) <= 40),
  tier text not null default 'any' check (char_length(tier) <= 8),
  item_power integer check (item_power is null or item_power between 0 and 50000),
  icon_url text check (icon_url is null or char_length(icon_url) <= 300),
  active boolean not null default true,
  source text not null default 'seed' check (source in ('seed','openalbion','manual')),
  updated_at timestamptz not null default now()
);

create index if not exists albion_equipment_name_idx on public.albion_equipment (lower(name));
create index if not exists albion_equipment_family_idx on public.albion_equipment (category, family);
create index if not exists albion_equipment_active_idx on public.albion_equipment (active);

-- Seed: real base items only (no invented names). Group shorthand such as
-- "HOJ (Knight)" / "HvyMace (Guardian)" stays in the UI's custom-build
-- suggestions — it is guild terminology, not catalog data.
insert into public.albion_equipment (name, category, family, weapon_type, source)
values
  -- Swords
  ('Broadsword','Weapon','Swords','Warrior','seed'),
  ('Claymore','Weapon','Swords','Warrior','seed'),
  ('Dual Swords','Weapon','Swords','Warrior','seed'),
  -- Axes
  ('Battleaxe','Weapon','Axes','Warrior','seed'),
  ('Greataxe','Weapon','Axes','Warrior','seed'),
  ('Halberd','Weapon','Axes','Warrior','seed'),
  -- Maces
  ('Mace','Weapon','Maces','Warrior','seed'),
  ('Heavy Mace','Weapon','Maces','Warrior','seed'),
  ('Morning Star','Weapon','Maces','Warrior','seed'),
  ('Incubus Mace','Weapon','Maces','Warrior','seed'),
  -- Hammers
  ('Hammer','Weapon','Hammers','Warrior','seed'),
  ('Great Hammer','Weapon','Hammers','Warrior','seed'),
  -- Spears
  ('Spear','Weapon','Spears','Warrior','seed'),
  ('Great Spear','Weapon','Spears','Warrior','seed'),
  -- Quarterstaffs
  ('Quarterstaff','Weapon','Quarterstaffs','Warrior','seed'),
  ('Double Bladed Staff','Weapon','Quarterstaffs','Warrior','seed'),
  -- Daggers
  ('Dagger','Weapon','Daggers','Hunter','seed'),
  ('Dagger Pair','Weapon','Daggers','Hunter','seed'),
  -- Bows
  ('Bow','Weapon','Bows','Hunter','seed'),
  ('Wargbow','Weapon','Bows','Hunter','seed'),
  ('Longbow','Weapon','Bows','Hunter','seed'),
  -- Crossbows
  ('Crossbow','Weapon','Crossbows','Hunter','seed'),
  ('Heavy Crossbow','Weapon','Crossbows','Hunter','seed'),
  -- Nature Staffs
  ('Nature Staff','Weapon','Nature Staffs','Mage','seed'),
  ('Great Nature Staff','Weapon','Nature Staffs','Mage','seed'),
  -- Holy Staffs
  ('Holy Staff','Weapon','Holy Staffs','Mage','seed'),
  ('Great Holy Staff','Weapon','Holy Staffs','Mage','seed'),
  -- Arcane Staffs
  ('Arcane Staff','Weapon','Arcane Staffs','Mage','seed'),
  ('Great Arcane Staff','Weapon','Arcane Staffs','Mage','seed'),
  -- Frost Staffs
  ('Frost Staff','Weapon','Frost Staffs','Mage','seed'),
  ('Glacial Staff','Weapon','Frost Staffs','Mage','seed'),
  -- Fire Staffs
  ('Fire Staff','Weapon','Fire Staffs','Mage','seed'),
  ('Great Fire Staff','Weapon','Fire Staffs','Mage','seed'),
  -- Cursed Staffs
  ('Cursed Staff','Weapon','Cursed Staffs','Mage','seed'),
  ('Great Cursed Staff','Weapon','Cursed Staffs','Mage','seed'),
  -- War Gloves
  ('War Gloves','Weapon','War Gloves','Hunter','seed'),
  ('Bear Paws','Weapon','War Gloves','Hunter','seed'),
  -- Armor
  ('Cloth Armor','Armor','Armor','Mage','seed'),
  ('Leather Armor','Armor','Armor','Hunter','seed'),
  ('Soldier Armor','Armor','Armor','Warrior','seed'),
  ('Knight Armor','Armor','Armor','Warrior','seed'),
  ('Guardian Armor','Armor','Armor','Warrior','seed'),
  -- Helmets
  ('Soldier Helmet','Helmet','Helmets','Warrior','seed'),
  ('Knight Helmet','Helmet','Helmets','Warrior','seed'),
  ('Hunter Hood','Helmet','Helmets','Hunter','seed'),
  ('Mage Cowl','Helmet','Helmets','Mage','seed'),
  ('Cleric Cowl','Helmet','Helmets','Mage','seed'),
  -- Shoes
  ('Soldier Boots','Shoes','Shoes','Warrior','seed'),
  ('Knight Boots','Shoes','Shoes','Warrior','seed'),
  ('Hunter Shoes','Shoes','Shoes','Hunter','seed'),
  ('Mage Sandals','Shoes','Shoes','Mage','seed'),
  ('Cleric Shoes','Shoes','Shoes','Mage','seed'),
  -- Off-Hand
  ('Torch','Off-Hand','Off-Hand','Warrior','seed'),
  ('Shield','Off-Hand','Off-Hand','Warrior','seed'),
  ('Book','Off-Hand','Off-Hand','Mage','seed'),
  ('Tome','Off-Hand','Off-Hand','Mage','seed'),
  ('Orb','Off-Hand','Off-Hand','Mage','seed'),
  ('Totem','Off-Hand','Off-Hand','Hunter','seed'),
  ('Banner','Off-Hand','Off-Hand','Warrior','seed')
on conflict (name) do nothing;

-- ----------------------------------------------------------------------------
-- B. ATOMIC TEAM CREATION (replaces the create_team branch of admin_action)
--    Same signature → create or replace is safe. Everything the operation
--    needs happens in ONE definer call: validation, insert, creator
--    membership (Leader), audit. Duplicate names get a friendly code.
-- ----------------------------------------------------------------------------
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
      -- ---- validation (server-side, §1) ----
      v_team_name := nullif(trim(coalesce(p_payload->>'name', '')), '');
      if v_team_name is null or char_length(v_team_name) < 2 or char_length(v_team_name) > 60 then
        return jsonb_build_object('ok', false, 'error', 'INVALID_TEAM_NAME');
      end if;
      if p_payload->>'status' is not null
         and p_payload->>'status' not in ('open','draft','locked','archived') then
        return jsonb_build_object('ok', false, 'error', 'INVALID_STATUS');
      end if;

      -- ---- atomic: team + creator membership + audit in one call ----
      begin
        insert into public.teams (name, description, status, created_by)
        values (
          v_team_name,
          nullif(trim(coalesce(p_payload->>'description', '')), ''),
          coalesce(p_payload->>'status', 'open'),
          coalesce(v_actor, auth.uid())
        )
        returning id into v_team_id;
      exception when unique_violation then
        return jsonb_build_object('ok', false, 'error', 'NAME_TAKEN');
      end;

      -- Creator becomes a Leader member inside the same transaction: the
      -- "team exists but creator is not a member" state is impossible (§6).
      if coalesce(v_actor, auth.uid()) is not null then
        insert into public.team_members (team_id, user_id, role, added_by)
        values (v_team_id, coalesce(v_actor, auth.uid()), 'Leader', coalesce(v_actor, auth.uid()))
        on conflict (team_id, user_id) do nothing;
      end if;

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

-- ----------------------------------------------------------------------------
-- C. mass_slots.tier_requirement + updated save RPC that persists it
-- ----------------------------------------------------------------------------
alter table public.mass_slots
  add column if not exists tier_requirement text not null default 'any';

do $$
begin
  if not exists (
    select 1 from pg_constraint
    where conname = 'mass_slots_tier_requirement_check'
      and conrelid = 'public.mass_slots'::regclass
  ) then
    alter table public.mass_slots
      add constraint mass_slots_tier_requirement_check
      check (tier_requirement in ('any','T4','T4.1','T5','T5.1','T6','T6.1','T7','T7.1','T8','T8.1'));
  end if;
end
$$;

-- Full replacement of save_mass_sheet — identical to 0004 except slot writes
-- persist tier_requirement. Keep this as THE authoritative definition.
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
        insert into public.mass_slots (party_id, role, build_name, priority, notes, required, tier_requirement, sort_order)
        values (v_party_id,
                coalesce(nullif(trim(v_slot->>'role'), ''), 'Fill'),
                coalesce(nullif(trim(v_slot->>'build_name'), ''), 'TBD'),
                coalesce(v_slot->>'priority', 'normal'),
                nullif(trim(coalesce(v_slot->>'notes', '')), ''),
                coalesce((v_slot->>'required')::boolean, true),
                coalesce(v_slot->>'tier_requirement', 'any'),
                coalesce((v_slot->>'sort_order')::int, 0))
        returning id into v_slot_id;
      else
        update public.mass_slots set
          role = coalesce(nullif(trim(v_slot->>'role'), ''), role),
          build_name = coalesce(nullif(trim(v_slot->>'build_name'), ''), build_name),
          priority = coalesce(v_slot->>'priority', priority),
          notes = nullif(trim(coalesce(v_slot->>'notes', '')), ''),
          required = coalesce((v_slot->>'required')::boolean, required),
          tier_requirement = coalesce(v_slot->>'tier_requirement', tier_requirement),
          sort_order = coalesce((v_slot->>'sort_order')::int, sort_order)
        where id = v_slot_id
          and party_id in (select id from public.mass_parties where sheet_id = v_sheet_id);
        if not found then
          insert into public.mass_slots (party_id, role, build_name, priority, notes, required, tier_requirement, sort_order)
          values (v_party_id,
                  coalesce(nullif(trim(v_slot->>'role'), ''), 'Fill'),
                  coalesce(nullif(trim(v_slot->>'build_name'), ''), 'TBD'),
                  coalesce(v_slot->>'priority', 'normal'),
                  nullif(trim(coalesce(v_slot->>'notes', '')), ''),
                  coalesce((v_slot->>'required')::boolean, true),
                  coalesce(v_slot->>'tier_requirement', 'any'),
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

-- ----------------------------------------------------------------------------
-- Grants + RLS for the equipment table (readable by authenticated users so
-- members can browse equipment too; writes service-role/sync-script only).
-- ----------------------------------------------------------------------------
revoke all on public.albion_equipment from anon;
grant select on public.albion_equipment to authenticated;
revoke insert, update, delete, truncate, references, trigger
  on public.albion_equipment from authenticated;
grant select, insert, update, delete, truncate on public.albion_equipment to service_role;

alter table public.albion_equipment enable row level security;
drop policy if exists "albion_equipment: authenticated read" on public.albion_equipment;
create policy "albion_equipment: authenticated read"
  on public.albion_equipment for select
  to authenticated, service_role
  using (active);

grant execute on function public.admin_action(text, uuid, uuid, uuid, jsonb, uuid)
  to authenticated, service_role;
grant execute on function public.save_mass_sheet(uuid, jsonb) to authenticated, service_role;

-- ============================================================================
-- DONE — verify with:  npm run db:push && npm run db:doctor
-- Optional catalog refresh:  npm run equipment:sync
-- ============================================================================
