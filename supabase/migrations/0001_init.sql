-- ============================================================================
-- 0001 — ALBION EVENT / MASS SCHEDULING — AUTHORITATIVE SCHEMA (2026 revamp)
--
-- Replaces the legacy Team architecture entirely (see supabase/migrations-
-- legacy/ for the old system). Core model:
--
--   profiles → events → event_parties → event_slots → event_signups
--   event_slots → event_slot_requirements (composable equipment per row)
--   albion_equipment (catalog) · notifications · audit_logs
--
-- Security model (unchanged in spirit from the legacy repairs):
--   * RLS enabled on every table; anon keeps ZERO access.
--   * No policy queries its own table → 42P17 recursion is impossible.
--   * authenticated = SELECT at grant level everywhere; ALL writes flow
--     through security-definer RPCs that re-verify identity and role inside
--     the database. Grant + policy + RPC = three independent gates.
--   * Members can only ever write their OWN signup rows.
-- ============================================================================

-- ----------------------------------------------------------------------------
-- 1. PROFILES (unchanged in spirit: app-level user data, mirrors auth.users)
-- ----------------------------------------------------------------------------
create table if not exists public.profiles (
  id uuid primary key references auth.users(id) on delete cascade,
  ign text not null unique check (char_length(ign) between 2 and 32),
  discord text check (discord is null or char_length(discord) <= 60),
  status text not null default 'pending'
    check (status in ('pending','approved','suspended','rejected','archived')),
  is_platform_admin boolean not null default false,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index if not exists profiles_status_idx on public.profiles (status);

-- ----------------------------------------------------------------------------
-- 2. EVENTS — the central entity
-- ----------------------------------------------------------------------------
create table if not exists public.events (
  id uuid primary key default gen_random_uuid(),
  title text not null check (char_length(title) between 2 and 120),
  description text check (description is null or char_length(description) <= 2000),
  event_date date,
  massing_time time,
  timezone text not null default 'UTC',
  location text check (location is null or char_length(location) <= 120),
  portal text check (portal is null or char_length(portal) <= 120),
  set_name text check (set_name is null or char_length(set_name) <= 60),
  caller text check (caller is null or char_length(caller) <= 60),
  instructions text check (instructions is null or char_length(instructions) <= 2000),
  status text not null default 'draft'
    check (status in ('draft','published','locked','completed','cancelled','archived')),
  is_template boolean not null default false,
  created_by uuid references public.profiles(id),
  published_at timestamptz,
  locked_at timestamptz,
  cancelled_at timestamptz,
  completed_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index if not exists events_status_idx on public.events (status, event_date);

-- ----------------------------------------------------------------------------
-- 3. EVENT PARTIES
-- ----------------------------------------------------------------------------
create table if not exists public.event_parties (
  id uuid primary key default gen_random_uuid(),
  event_id uuid not null references public.events(id) on delete cascade,
  name text not null check (char_length(name) between 1 and 80),
  fill_note text check (fill_note is null or char_length(fill_note) <= 200),
  sort_order integer not null default 0
);

create index if not exists event_parties_event_idx on public.event_parties (event_id, sort_order);

-- ----------------------------------------------------------------------------
-- 4. EVENT SLOTS
-- ----------------------------------------------------------------------------
create table if not exists public.event_slots (
  id uuid primary key default gen_random_uuid(),
  party_id uuid not null references public.event_parties(id) on delete cascade,
  role text not null check (char_length(role) between 1 and 40),
  notes text check (notes is null or char_length(notes) <= 200),
  priority text not null default 'normal' check (priority in ('high','normal','low')),
  required boolean not null default true,
  sort_order integer not null default 0
);

create index if not exists event_slots_party_idx on public.event_slots (party_id, sort_order);

-- ----------------------------------------------------------------------------
-- 4b. SLOT EQUIPMENT REQUIREMENTS — the composable heart of the sheet.
--
-- A slot is a SPREADSHEET ROW, not a character build: it carries ANY number
-- of requirements (0..n) across the full equipment taxonomy:
--
--   TANK        → Weapon + Head + Chest + Feet + Off-Hand
--   DPS         → Weapon only
--   BATTLEMOUNT → Mount + Weapon (+ anything else the admin adds)
--   CALLER      → Weapon (+ instructions in slot.notes)
--
-- Roles are free-text labels (Tank/DPS/Healer/Support/Caller/Battlemount or
-- anything the organizer types); the catalog is a PICKER AID and `item`
-- stays free text so group shorthand ("SOB / ICICLE") never blocks saving.
-- ----------------------------------------------------------------------------
create table if not exists public.event_slot_requirements (
  id uuid primary key default gen_random_uuid(),
  slot_id uuid not null references public.event_slots(id) on delete cascade,
  category text not null
    check (category in ('Weapon','Head','Chest','Feet','Off-Hand','Mount','Cape','Bag','Other')),
  item text not null check (char_length(item) between 1 and 120),
  tier_requirement text not null default 'any'
    check (tier_requirement in ('any','T4','T4.1','T5','T5.1','T6','T6.1','T7','T7.1','T8','T8.1')),
  sort_order integer not null default 0
);

create index if not exists event_slot_requirements_slot_idx
  on public.event_slot_requirements (slot_id, sort_order);

-- In-place upgrade for databases that ran the pre-rebuild schema (one
-- free-text `equipment` column per slot): migrate every value into a Weapon-
-- category requirement, then drop the legacy columns. No-ops on fresh DBs.
do $$
declare
  has_legacy boolean;
begin
  select count(*) > 0 into has_legacy
  from information_schema.columns
  where table_schema = 'public' and table_name = 'event_slots' and column_name = 'equipment';

  if has_legacy then
    insert into public.event_slot_requirements (slot_id, category, item, tier_requirement, sort_order)
    select id, 'Weapon', trim(equipment), coalesce(tier_requirement, 'any'), 0
    from public.event_slots
    where equipment is not null
      and trim(equipment) <> ''
      and lower(trim(equipment)) <> 'tbd';

    execute 'alter table public.event_slots drop column equipment';
  end if;

  select count(*) > 0 into has_legacy
  from information_schema.columns
  where table_schema = 'public' and table_name = 'event_slots' and column_name = 'tier_requirement';

  if has_legacy then
    execute 'alter table public.event_slots drop column tier_requirement';
  end if;
end
$$;

-- ----------------------------------------------------------------------------
-- 5. EVENT SIGNUPS — member self-registration
--    UNIQUE(slot_id): one active signup per slot — the race-decider (§34).
--    UNIQUE(event_id, user_id): one signup per member per event (§10);
--    the admin RPC moves members by delete+insert inside one transaction.
-- ----------------------------------------------------------------------------
create table if not exists public.event_signups (
  id uuid primary key default gen_random_uuid(),
  slot_id uuid not null unique references public.event_slots(id) on delete cascade,
  event_id uuid not null references public.events(id) on delete cascade,
  user_id uuid not null references public.profiles(id) on delete cascade,
  ign text not null check (char_length(ign) between 2 and 32),
  note text check (note is null or char_length(note) <= 200),
  signed_up_at timestamptz not null default now(),
  unique (event_id, user_id)
);

create index if not exists event_signups_user_idx on public.event_signups (user_id);
create index if not exists event_signups_event_idx on public.event_signups (event_id);

-- ----------------------------------------------------------------------------
-- 6. ALBION EQUIPMENT CATALOG (Phase 18–25)
-- ----------------------------------------------------------------------------
create table if not exists public.albion_equipment (
  id uuid primary key default gen_random_uuid(),
  external_id text,
  name text not null unique check (char_length(name) between 2 and 80),
  category text not null constraint albion_equipment_category_check check (category in
    ('Weapon','Head','Chest','Feet','Off-Hand','Mount','Cape','Bag','Other')),
  family text not null check (char_length(family) between 2 and 40),
  equipment_type text check (equipment_type is null or char_length(equipment_type) <= 40),
  tier text not null default 'any' check (char_length(tier) <= 8),
  item_power integer check (item_power is null or item_power between 0 and 50000),
  icon_url text check (icon_url is null or char_length(icon_url) <= 300),
  description text check (description is null or char_length(description) <= 300),
  source text not null default 'seed' check (source in ('seed','openalbion','manual')),
  source_url text,
  active boolean not null default true,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index if not exists albion_equipment_name_idx on public.albion_equipment (lower(name));
create index if not exists albion_equipment_family_idx on public.albion_equipment (category, family);

-- In-place upgrade for pre-rebuild databases: the old taxonomy lumped armor
-- into one 'Armor' category with separate Helmet/Shoes tables-of-thought.
-- Re-map to the slot-requirement taxonomy (Head/Chest/Feet), then swap the
-- check constraint for the new value set. No-op on fresh databases.
do $$
declare
  v_con text;
begin
  if exists (select 1 from information_schema.tables
             where table_schema = 'public' and table_name = 'albion_equipment') then
    update public.albion_equipment set category = 'Chest' where category = 'Armor';
    update public.albion_equipment set category = 'Head' where category = 'Helmet';
    update public.albion_equipment set category = 'Feet' where category = 'Shoes';

    select conname into v_con from pg_constraint
    where conrelid = 'public.albion_equipment'::regclass and contype = 'c'
      and pg_get_constraintdef(oid) like '%category%' limit 1;
    if v_con is not null then
      execute format('alter table public.albion_equipment drop constraint %I', v_con);
    end if;
    alter table public.albion_equipment add constraint albion_equipment_category_check
      check (category in ('Weapon','Head','Chest','Feet','Off-Hand','Mount','Cape','Bag','Other'));
  end if;
end
$$;

-- ----------------------------------------------------------------------------
-- 7. NOTIFICATIONS
-- ----------------------------------------------------------------------------
create table if not exists public.notifications (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references public.profiles(id) on delete cascade,
  title text not null check (char_length(title) between 1 and 120),
  body text check (body is null or char_length(body) <= 500),
  kind text not null default 'info' check (kind in ('info','success','error','event')),
  link text check (link is null or char_length(link) <= 300),
  read boolean not null default false,
  created_at timestamptz not null default now()
);

create index if not exists notifications_user_idx on public.notifications (user_id, read, created_at desc);

-- ----------------------------------------------------------------------------
-- 8. AUDIT LOG (append-only)
-- ----------------------------------------------------------------------------
create table if not exists public.audit_logs (
  id uuid primary key default gen_random_uuid(),
  action text not null,
  actor_id uuid references public.profiles(id),
  target_user_id uuid references public.profiles(id),
  event_id uuid references public.events(id) on delete set null,
  meta jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now()
);

create index if not exists audit_logs_created_idx on public.audit_logs (created_at desc);
create index if not exists audit_logs_event_idx on public.audit_logs (event_id);

-- ============================================================================
-- 9. HELPERS (security definer — 42P17-safe, evaluated as owner)
-- ============================================================================

-- Role resolution used everywhere: admin = is_platform_admin AND approved.
create or replace function public.is_event_admin()
returns boolean
language sql
stable
set search_path = public
as $$
  select coalesce(
    (select p.is_platform_admin from public.profiles p where p.id = auth.uid()), false)
  and coalesce(
    (select p.status = 'approved' from public.profiles p where p.id = auth.uid()), false);
$$;

-- Which events the current user can SEE: admins see all; approved members
-- see published/locked/completed events plus their own drafts? No — drafts
-- are admin-only. Templates are admin-only too.
create or replace function public.is_event_visible(p_event_id uuid)
returns boolean
language sql
security definer
set search_path = public
stable
as $$
  select exists (
    select 1 from public.events e
    where e.id = p_event_id
      and (
        public.is_event_admin()
        or (
          coalesce(
            (select p.status = 'approved' from public.profiles p where p.id = auth.uid()), false)
          and e.status in ('published','locked','completed')
        )
      )
  );
$$;

create or replace function public.is_event_party_visible(p_party_id uuid)
returns boolean
language sql
security definer
set search_path = public
stable
as $$
  select exists (
    select 1 from public.event_parties ep
    where ep.id = p_party_id and public.is_event_visible(ep.event_id)
  );
$$;

create or replace function public.is_event_slot_visible(p_slot_id uuid)
returns boolean
language sql
security definer
set search_path = public
stable
as $$
  select exists (
    select 1 from public.event_slots es
    join public.event_parties ep on ep.id = es.party_id
    where es.id = p_slot_id and public.is_event_visible(ep.event_id)
  );
$$;

-- ============================================================================
-- 10. RPCs — member signup path (§10–12, §34)
-- ============================================================================

-- Claim a slot. UNIQUE(slot_id) decides races; the RPC maps the loss to
-- SLOT_TAKEN. Identity always from auth.uid(); approved members only;
-- published events only.
create or replace function public.claim_event_slot(p_slot_id uuid, p_note text default null)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_slot record;
  v_event public.events;
  v_note text;
begin
  if auth.uid() is null then
    return jsonb_build_object('ok', false, 'error', 'UNAUTHENTICATED');
  end if;

  v_note := nullif(trim(coalesce(p_note, '')), '');
  if v_note is not null and char_length(v_note) > 200 then
    return jsonb_build_object('ok', false, 'error', 'INVALID_NOTE');
  end if;

  select es.party_id, ep.event_id into v_slot
  from public.event_slots es
  join public.event_parties ep on ep.id = es.party_id
  where es.id = p_slot_id;
  if not found then
    return jsonb_build_object('ok', false, 'error', 'SLOT_NOT_FOUND');
  end if;

  select * into v_event from public.events where id = v_slot.event_id;
  if v_event.status <> 'published' then
    return jsonb_build_object('ok', false, 'error', 'EVENT_NOT_OPEN');
  end if;

  if not exists (
    select 1 from public.profiles
    where id = auth.uid() and status = 'approved'
  ) then
    return jsonb_build_object('ok', false, 'error', 'ACCOUNT_NOT_APPROVED');
  end if;

  -- One signup per member per event (§34).
  if exists (
    select 1 from public.event_signups
    where event_id = v_slot.event_id and user_id = auth.uid()
  ) then
    return jsonb_build_object('ok', false, 'error', 'ALREADY_SIGNED_UP');
  end if;

  -- Own IGN from the profile — members never type it repeatedly (§11).
  insert into public.event_signups (slot_id, event_id, user_id, ign, note)
  select p_slot_id, v_slot.event_id, auth.uid(), p.ign, v_note
  from public.profiles p
  where p.id = auth.uid();

  -- A missing profile row must never silently "succeed".
  if not found then
    return jsonb_build_object('ok', false, 'error', 'PROFILE_NOT_FOUND');
  end if;

  insert into public.audit_logs (action, actor_id, target_user_id, event_id, meta)
  values ('SIGNUP_CREATED', auth.uid(), auth.uid(), v_slot.event_id,
    jsonb_build_object('slot_id', p_slot_id, 'ign',
      (select ign from public.event_signups where slot_id = p_slot_id)));

  return jsonb_build_object('ok', true);
exception
  when unique_violation then
    -- Lost the claim race, or signed up twice concurrently.
    if exists (select 1 from public.event_signups where event_id = v_slot.event_id and user_id = auth.uid()) then
      return jsonb_build_object('ok', false, 'error', 'ALREADY_SIGNED_UP');
    end if;
    return jsonb_build_object('ok', false, 'error', 'SLOT_TAKEN');
end;
$$;

-- Leave own slot.
create or replace function public.leave_event_slot(p_slot_id uuid)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_event_id uuid;
  v_ign text;
begin
  if auth.uid() is null then
    return jsonb_build_object('ok', false, 'error', 'UNAUTHENTICATED');
  end if;

  select es.event_id into v_event_id
  from public.event_slots es
  where es.id = p_slot_id;
  if not found then
    return jsonb_build_object('ok', false, 'error', 'SLOT_NOT_FOUND');
  end if;

  delete from public.event_signups
  where slot_id = p_slot_id and user_id = auth.uid()
  returning ign into v_ign;

  if v_ign is null then
    return jsonb_build_object('ok', false, 'error', 'NOT_SIGNED_UP');
  end if;

  insert into public.audit_logs (action, actor_id, target_user_id, event_id, meta)
  values ('SIGNUP_REMOVED', auth.uid(), auth.uid(), v_event_id,
    jsonb_build_object('slot_id', p_slot_id, 'by', 'member'));

  return jsonb_build_object('ok', true);
end;
$$;

-- ============================================================================
-- 11. RPCs — admin event management (§13, §29)
-- ============================================================================

-- Save an event (create or update) atomically: header + parties + slots.
create or replace function public.save_event(
  p_event_id uuid,
  p_data jsonb
)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_actor uuid := auth.uid();
  v_event_id uuid := p_event_id;
  v_is_new boolean := false;
  v_party jsonb;
  v_slot jsonb;
  v_req jsonb;
  v_req_idx integer;
  v_item text;
  v_party_id uuid;
  v_slot_id uuid;
  v_kept_slot_ids uuid[] := '{}';
  v_kept_party_ids uuid[] := '{}';
  v_title text;
begin
  if not public.is_event_admin() then
    return jsonb_build_object('ok', false, 'error', 'FORBIDDEN');
  end if;

  -- DRAFT-ONLY VALIDATION (§5): a draft needs almost nothing. The only hard
  -- requirement is a usable title; everything else may be empty. Publish-time
  -- completeness is a separate, stricter gate handled in the UI.
  v_title := nullif(trim(coalesce(p_data->>'title', '')), '');
  if v_title is null or char_length(v_title) < 2 or char_length(v_title) > 120 then
    return jsonb_build_object('ok', false, 'error', 'INVALID_TITLE');
  end if;

  if p_event_id is null then
    insert into public.events (title, created_by, is_template, event_date)
    values (v_title, v_actor,
            coalesce((p_data->>'is_template')::boolean, false),
            nullif(p_data->>'event_date', '')::date)
    returning id into v_event_id;
    v_is_new := true;
    insert into public.audit_logs (action, actor_id, event_id, meta)
    values ('EVENT_CREATED', v_actor, v_event_id, jsonb_build_object('title', v_title));
  else
    -- The event must exist and belong to this database (guards editing a
    -- concurrently-deleted event: without this row the UPDATE is a silent no-op).
    if not exists (select 1 from public.events where id = v_event_id) then
      return jsonb_build_object('ok', false, 'error', 'NOT_FOUND');
    end if;
  end if;

  update public.events set
    title        = v_title,
    description  = nullif(p_data->>'description', ''),
    event_date   = nullif(p_data->>'event_date', '')::date,
    massing_time = nullif(p_data->>'massing_time', '')::time,
    timezone     = coalesce(nullif(trim(p_data->>'timezone'), ''), timezone),
    location     = nullif(trim(p_data->>'location'), ''),
    portal       = nullif(trim(p_data->>'portal'), ''),
    set_name     = nullif(trim(p_data->>'set_name'), ''),
    caller       = nullif(trim(p_data->>'caller'), ''),
    instructions = nullif(p_data->>'instructions', ''),
    is_template  = coalesce((p_data->>'is_template')::boolean, is_template),
    updated_at   = now()
  where id = v_event_id;

  for v_party in select * from jsonb_array_elements(coalesce(p_data->'parties', '[]'::jsonb))
  loop
    v_party_id := nullif(v_party->>'id', '')::uuid;
    if v_party_id is null then
      insert into public.event_parties (event_id, name, fill_note, sort_order)
      values (v_event_id,
              coalesce(nullif(trim(v_party->>'name'), ''), 'Party'),
              nullif(trim(coalesce(v_party->>'fill_note', '')), ''),
              coalesce((v_party->>'sort_order')::int, 0))
      returning id into v_party_id;
    else
      update public.event_parties set
        name = coalesce(nullif(trim(v_party->>'name'), ''), name),
        fill_note = nullif(trim(coalesce(v_party->>'fill_note', '')), ''),
        sort_order = coalesce((v_party->>'sort_order')::int, sort_order)
      where id = v_party_id and event_id = v_event_id;
      if not found then
        insert into public.event_parties (event_id, name, fill_note, sort_order)
        values (v_event_id,
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
        insert into public.event_slots (party_id, role, notes, priority, required, sort_order)
        values (v_party_id,
                coalesce(nullif(trim(v_slot->>'role'), ''), 'Fill'),
                nullif(trim(coalesce(v_slot->>'notes', '')), ''),
                coalesce(v_slot->>'priority', 'normal'),
                coalesce((v_slot->>'required')::boolean, true),
                coalesce((v_slot->>'sort_order')::int, 0))
        returning id into v_slot_id;
      else
        update public.event_slots set
          role = coalesce(nullif(trim(v_slot->>'role'), ''), role),
          notes = nullif(trim(coalesce(v_slot->>'notes', '')), ''),
          priority = coalesce(v_slot->>'priority', priority),
          required = coalesce((v_slot->>'required')::boolean, required),
          sort_order = coalesce((v_slot->>'sort_order')::int, sort_order)
        where id = v_slot_id
          and party_id in (select id from public.event_parties where event_id = v_event_id);
        if not found then
          insert into public.event_slots (party_id, role, notes, priority, required, sort_order)
          values (v_party_id,
                  coalesce(nullif(trim(v_slot->>'role'), ''), 'Fill'),
                  nullif(trim(coalesce(v_slot->>'notes', '')), ''),
                  coalesce(v_slot->>'priority', 'normal'),
                  coalesce((v_slot->>'required')::boolean, true),
                  coalesce((v_slot->>'sort_order')::int, 0))
          returning id into v_slot_id;
        end if;
      end if;

      -- Equipment requirements: replace the slot's set wholesale so removals
      -- and reorders in the builder always match the sheet exactly. Free-text
      -- item names are allowed (§10) — no catalog join, no validation beyond
      -- length. Empty items are skipped so half-typed rows never error.
      delete from public.event_slot_requirements where slot_id = v_slot_id;
      for v_req_idx in 0 .. coalesce(jsonb_array_length(v_slot->'requirements'), 0) - 1
      loop
        v_req := v_slot->'requirements'->v_req_idx;
        v_item := nullif(trim(coalesce(v_req->>'item', '')), '');
        if v_item is not null then
          insert into public.event_slot_requirements (slot_id, category, item, tier_requirement, sort_order)
          values (v_slot_id,
                  coalesce(v_req->>'category', 'Weapon'),
                  left(v_item, 120),
                  coalesce(v_req->>'tier_requirement', 'any'),
                  v_req_idx);
        end if;
      end loop;

      v_kept_slot_ids := array_append(v_kept_slot_ids, v_slot_id);
    end loop;
  end loop;

  delete from public.event_slots
   where party_id in (select id from public.event_parties where event_id = v_event_id)
     and not (id = any(v_kept_slot_ids));
  delete from public.event_parties
   where event_id = v_event_id and not (id = any(v_kept_party_ids));

  insert into public.audit_logs (action, actor_id, event_id, meta)
  select 'EVENT_UPDATED', v_actor, e.id, jsonb_build_object('was_new', v_is_new)
  from public.events e where e.id = v_event_id;

  return jsonb_build_object('ok', true, 'id', v_event_id, 'created', v_is_new);
end;
$$;

-- Lifecycle transitions with timestamps + audit.
create or replace function public.set_event_status(p_event_id uuid, p_status text)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_event public.events;
  v_actor uuid := auth.uid();
begin
  if not public.is_event_admin() then
    return jsonb_build_object('ok', false, 'error', 'FORBIDDEN');
  end if;
  if p_status not in ('draft','published','locked','completed','cancelled','archived') then
    return jsonb_build_object('ok', false, 'error', 'INVALID_STATUS');
  end if;

  select * into v_event from public.events where id = p_event_id;
  if not found then
    return jsonb_build_object('ok', false, 'error', 'NOT_FOUND');
  end if;
  if v_event.status = p_status then
    return jsonb_build_object('ok', true);
  end if;

  update public.events set
    status = p_status,
    published_at = case when p_status = 'published' then now() else published_at end,
    locked_at    = case when p_status = 'locked' then now() else locked_at end,
    cancelled_at = case when p_status = 'cancelled' then now() else cancelled_at end,
    completed_at = case when p_status = 'completed' then now() else completed_at end,
    updated_at   = now()
  where id = p_event_id;

  insert into public.audit_logs (action, actor_id, event_id, meta)
  values (
    case p_status
      when 'published' then 'EVENT_PUBLISHED'
      when 'locked' then 'EVENT_LOCKED'
      when 'cancelled' then 'EVENT_CANCELLED'
      when 'completed' then 'EVENT_COMPLETED'
      when 'archived' then 'EVENT_ARCHIVED'
      else 'EVENT_RESTORED'
    end,
    v_actor, v_event.id,
    jsonb_build_object('previous_status', v_event.status, 'new_status', p_status));

  -- Notify approved members when an event is (re)published.
  if p_status = 'published' then
    insert into public.notifications (user_id, title, body, kind, link)
    select p.id,
      'New event: ' || v_event.title,
      concat_ws(' · ',
        v_event.location,
        v_event.event_date::text,
        v_event.massing_time::text || ' ' || v_event.timezone),
      'event',
      '/events/' || v_event.id::text
    from public.profiles p
    where p.status = 'approved' and p.id <> coalesce(v_actor, auth.uid());
  end if;

  return jsonb_build_object('ok', true);
end;
$$;

-- Duplicate an event as a fresh draft (structure only, never signups) — §15.
create or replace function public.duplicate_event(p_event_id uuid)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_src public.events;
  v_new_id uuid;
  v_party record;
  v_slot record;
  v_new_party uuid;
  v_new_slot uuid;
  v_actor uuid := auth.uid();
begin
  if not public.is_event_admin() then
    return jsonb_build_object('ok', false, 'error', 'FORBIDDEN');
  end if;

  select * into v_src from public.events where id = p_event_id;
  if not found then
    return jsonb_build_object('ok', false, 'error', 'NOT_FOUND');
  end if;

  insert into public.events (title, description, event_date, massing_time, timezone,
                             location, portal, set_name, caller, instructions,
                             status, is_template, created_by)
  values (left(v_src.title || ' (copy)', 120),
          v_src.description, null, v_src.massing_time, v_src.timezone,
          v_src.location, v_src.portal, v_src.set_name, v_src.caller, v_src.instructions,
          'draft', false, v_actor)
  returning id into v_new_id;

  for v_party in select * from public.event_parties where event_id = v_src.id order by sort_order
  loop
    insert into public.event_parties (event_id, name, fill_note, sort_order)
    values (v_new_id, v_party.name, v_party.fill_note, v_party.sort_order)
    returning id into v_new_party;
    for v_slot in select * from public.event_slots where party_id = v_party.id order by sort_order
    loop
      insert into public.event_slots (party_id, role, notes, priority, required, sort_order)
      values (v_new_party, v_slot.role, v_slot.notes, v_slot.priority, v_slot.required, v_slot.sort_order)
      returning id into v_new_slot;
      insert into public.event_slot_requirements (slot_id, category, item, tier_requirement, sort_order)
      select v_new_slot, category, item, tier_requirement, sort_order
      from public.event_slot_requirements where slot_id = v_slot.id
      order by sort_order;
    end loop;
  end loop;

  insert into public.audit_logs (action, actor_id, event_id, meta)
  values ('EVENT_DUPLICATED', v_actor, v_src.id, jsonb_build_object('new_id', v_new_id));

  return jsonb_build_object('ok', true, 'id', v_new_id);
end;
$$;

-- Admin: move a member between slots (delete + insert, one transaction) or
-- remove a signup entirely.
create or replace function public.admin_set_signup(p_slot_id uuid, p_user_id uuid)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_slot record;
  v_event public.events;
  v_old record;
  v_ign text;
begin
  if not public.is_event_admin() then
    return jsonb_build_object('ok', false, 'error', 'FORBIDDEN');
  end if;

  select es.party_id, ep.event_id into v_slot
  from public.event_slots es
  join public.event_parties ep on ep.id = es.party_id
  where es.id = p_slot_id;
  if not found then
    return jsonb_build_object('ok', false, 'error', 'SLOT_NOT_FOUND');
  end if;
  select * into v_event from public.events where id = v_slot.event_id;

  select * into v_old from public.event_signups where event_id = v_slot.event_id and user_id = p_user_id;

  if p_user_id is null then
    -- Remove the signup occupying this slot (slot currently filled).
    select * into v_old from public.event_signups where slot_id = p_slot_id;
    if not found then return jsonb_build_object('ok', true); end if;
    delete from public.event_signups where slot_id = p_slot_id;
    insert into public.audit_logs (action, actor_id, target_user_id, event_id, meta)
    values ('SIGNUP_REMOVED', auth.uid(), v_old.user_id, v_event.id,
      jsonb_build_object('slot_id', p_slot_id, 'by', 'admin'));
    return jsonb_build_object('ok', true);
  end if;

  if not exists (select 1 from public.profiles where id = p_user_id and status = 'approved') then
    return jsonb_build_object('ok', false, 'error', 'USER_NOT_APPROVED');
  end if;

  -- Move = clear previous signup for this member in this event, then insert.
  delete from public.event_signups where event_id = v_slot.event_id and user_id = p_user_id;
  insert into public.event_signups (slot_id, event_id, user_id, ign)
  select p_slot_id, v_slot.event_id, p_user_id, p.ign
  from public.profiles p where p.id = p_user_id;

  insert into public.audit_logs (action, actor_id, target_user_id, event_id, meta)
  values ('SIGNUP_MOVED', auth.uid(), p_user_id, v_event.id,
    jsonb_build_object('slot_id', p_slot_id,
      'previous_slot', v_old.slot_id));

  return jsonb_build_object('ok', true);
exception
  when unique_violation then
    return jsonb_build_object('ok', false, 'error', 'SLOT_TAKEN');
end;
$$;

-- ============================================================================
-- 12. GRANTS — authenticated SELECT-only everywhere; writes via RPCs
-- ============================================================================
revoke all on public.profiles        from anon;
revoke all on public.events          from anon;
revoke all on public.event_parties   from anon;
revoke all on public.event_slots     from anon;
revoke all on public.event_slot_requirements from anon;
revoke all on public.event_signups   from anon;
revoke all on public.albion_equipment from anon;
revoke all on public.notifications   from anon;
revoke all on public.audit_logs      from anon;

grant select on public.profiles, public.events, public.event_parties,
  public.event_slots, public.event_slot_requirements, public.event_signups,
  public.albion_equipment, public.notifications, public.audit_logs
  to authenticated;

revoke insert, update, delete, truncate, references, trigger
  on public.profiles, public.events, public.event_parties, public.event_slots,
     public.event_slot_requirements, public.event_signups, public.albion_equipment,
     public.notifications, public.audit_logs
  from authenticated;

grant select, insert, update, delete, truncate
  on public.profiles, public.events, public.event_parties, public.event_slots,
     public.event_slot_requirements, public.event_signups, public.albion_equipment,
     public.notifications, public.audit_logs
  to service_role;

grant execute on function public.is_event_admin() to anon, authenticated;
grant execute on function public.is_event_visible(uuid) to anon, authenticated;
grant execute on function public.is_event_party_visible(uuid) to anon, authenticated;
grant execute on function public.is_event_slot_visible(uuid) to anon, authenticated;

grant execute on function public.claim_event_slot(uuid, text) to authenticated, service_role;
grant execute on function public.leave_event_slot(uuid) to authenticated, service_role;
grant execute on function public.save_event(uuid, jsonb) to authenticated, service_role;
grant execute on function public.set_event_status(uuid, text) to authenticated, service_role;
grant execute on function public.duplicate_event(uuid) to authenticated, service_role;
grant execute on function public.admin_set_signup(uuid, uuid) to authenticated, service_role;

-- ============================================================================
-- 13. RLS
-- ============================================================================
alter table public.profiles        enable row level security;
alter table public.events          enable row level security;
alter table public.event_parties   enable row level security;
alter table public.event_slots     enable row level security;
alter table public.event_slot_requirements enable row level security;
alter table public.event_signups   enable row level security;
alter table public.albion_equipment enable row level security;
alter table public.notifications   enable row level security;
alter table public.audit_logs      enable row level security;

-- ---------- profiles ----------
drop policy if exists "profiles: own row or admin" on public.profiles;
create policy "profiles: own row or admin"
  on public.profiles for select
  to authenticated, service_role
  using (
    id = auth.uid()
    or public.is_event_admin()
  );

drop policy if exists "profiles: admin update" on public.profiles;
create policy "profiles: admin update"
  on public.profiles for update
  to authenticated, service_role
  using (public.is_event_admin())
  with check (public.is_event_admin());

-- (profile self-service updates for ign/discord flow through an RPC below.)

-- ---------- events ----------
drop policy if exists "events: visible read" on public.events;
create policy "events: visible read"
  on public.events for select
  to authenticated, service_role
  using (public.is_event_visible(id));

drop policy if exists "events: admins write" on public.events;
create policy "events: admins write"
  on public.events for all
  to authenticated, service_role
  using (public.is_event_admin())
  with check (public.is_event_admin());

-- ---------- event_parties ----------
drop policy if exists "event_parties: visible read" on public.event_parties;
create policy "event_parties: visible read"
  on public.event_parties for select
  to authenticated, service_role
  using (public.is_event_party_visible(id));

drop policy if exists "event_parties: admins write" on public.event_parties;
create policy "event_parties: admins write"
  on public.event_parties for all
  to authenticated, service_role
  using (public.is_event_admin())
  with check (public.is_event_admin());

-- ---------- event_slots ----------
drop policy if exists "event_slots: visible read" on public.event_slots;
create policy "event_slots: visible read"
  on public.event_slots for select
  to authenticated, service_role
  using (public.is_event_slot_visible(id));

drop policy if exists "event_slots: admins write" on public.event_slots;
create policy "event_slots: admins write"
  on public.event_slots for all
  to authenticated, service_role
  using (public.is_event_admin())
  with check (public.is_event_admin());

-- ---------- event_signups ----------
-- ---------- event_slot_requirements (visibility follows the slot) ----------
drop policy if exists "event_slot_requirements: visible read" on public.event_slot_requirements;
create policy "event_slot_requirements: visible read"
  on public.event_slot_requirements for select
  to authenticated, service_role
  using (public.is_event_slot_visible(slot_id));

drop policy if exists "event_slot_requirements: admins write" on public.event_slot_requirements;
create policy "event_slot_requirements: admins write"
  on public.event_slot_requirements for all
  to authenticated, service_role
  using (public.is_event_admin())
  with check (public.is_event_admin());

-- ---------- event_signups ----------
drop policy if exists "event_signups: visible read" on public.event_signups;
create policy "event_signups: visible read"
  on public.event_signups for select
  to authenticated, service_role
  using (public.is_event_slot_visible(slot_id));

-- Members write ONLY their own signup rows, on published events only.
drop policy if exists "event_signups: own row on published" on public.event_signups;
create policy "event_signups: own row on published"
  on public.event_signups for all
  to authenticated, service_role
  using (
    user_id = auth.uid()
    and exists (
      select 1
      from public.event_slots es
      join public.event_parties ep on ep.id = es.party_id
      join public.events e on e.id = ep.event_id
      where es.id = slot_id and e.status = 'published'
    )
  )
  with check (
    user_id = auth.uid()
    and exists (
      select 1
      from public.event_slots es
      join public.event_parties ep on ep.id = es.party_id
      join public.events e on e.id = ep.event_id
      where es.id = slot_id and e.status = 'published'
    )
  );

-- ---------- albion_equipment ----------
drop policy if exists "albion_equipment: authenticated read" on public.albion_equipment;
create policy "albion_equipment: authenticated read"
  on public.albion_equipment for select
  to authenticated, service_role
  using (active);

drop policy if exists "albion_equipment: admins manage" on public.albion_equipment;
create policy "albion_equipment: admins manage"
  on public.albion_equipment for all
  to authenticated, service_role
  using (public.is_event_admin())
  with check (public.is_event_admin());

-- ---------- notifications ----------
drop policy if exists "notifications: own read" on public.notifications;
create policy "notifications: own read"
  on public.notifications for select
  to authenticated, service_role
  using (user_id = auth.uid());

drop policy if exists "notifications: own mark-read" on public.notifications;
create policy "notifications: own mark-read"
  on public.notifications for update
  to authenticated, service_role
  using (user_id = auth.uid())
  with check (user_id = auth.uid());

drop policy if exists "notifications: admin insert" on public.notifications;
create policy "notifications: admin insert"
  on public.notifications for insert
  to authenticated, service_role
  with check (public.is_event_admin());

-- ---------- audit_logs: append-only ----------
drop policy if exists "audit_logs: admin read" on public.audit_logs;
create policy "audit_logs: admin read"
  on public.audit_logs for select
  to authenticated, service_role
  using (public.is_event_admin());

drop policy if exists "audit_logs: admin insert" on public.audit_logs;
create policy "audit_logs: admin insert"
  on public.audit_logs for insert
  to authenticated, service_role
  with check (public.is_event_admin());

-- ============================================================================
-- 14. PROFILE SELF-SERVICE (ign/discord) — definer RPC, columns scoped
-- ============================================================================
create or replace function public.update_own_profile(p_ign text, p_discord text)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
begin
  if auth.uid() is null then
    return jsonb_build_object('ok', false, 'error', 'UNAUTHENTICATED');
  end if;
  update public.profiles
     set ign = nullif(trim(p_ign), ''),
         discord = nullif(trim(p_discord), ''),
         updated_at = now()
   where id = auth.uid();
  if not found then
    return jsonb_build_object('ok', false, 'error', 'NOT_FOUND');
  end if;
  return jsonb_build_object('ok', true);
exception
  when unique_violation then
    return jsonb_build_object('ok', false, 'error', 'IGN_TAKEN');
end;
$$;
grant execute on function public.update_own_profile(text, text) to authenticated, service_role;

-- ============================================================================
-- 14b. ADMIN USER MANAGEMENT RPC — member oversight without any Team concept
--       (approve / reject / suspend / reactivate / archive / set_admin)
-- ============================================================================
create or replace function public.admin_user_action(
  p_action text,
  p_target_user_id uuid,
  p_payload jsonb default '{}'::jsonb
)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_actor uuid := auth.uid();
begin
  if not public.is_event_admin() then
    return jsonb_build_object('ok', false, 'error', 'FORBIDDEN');
  end if;

  case p_action
    when 'approve_user' then
      update public.profiles
         set status = 'approved', approved_at = now()
       where id = p_target_user_id and status in ('pending', 'suspended', 'rejected');
      if not found then
        return jsonb_build_object('ok', false, 'error', 'NOT_FOUND_OR_INVALID_STATE');
      end if;
      insert into public.notifications (user_id, title, body, kind, link)
      values (p_target_user_id, 'Account approved',
        'Your account has been approved. You can now sign up for events.', 'success', '/dashboard');

    when 'reject_user' then
      update public.profiles
         set status = 'rejected', suspended_at = null
       where id = p_target_user_id and status = 'pending';
      if not found then
        return jsonb_build_object('ok', false, 'error', 'NOT_FOUND_OR_INVALID_STATE');
      end if;

    when 'suspend_user' then
      update public.profiles
         set status = 'suspended', suspended_at = now()
       where id = p_target_user_id and status = 'approved';
      if not found then
        return jsonb_build_object('ok', false, 'error', 'NOT_FOUND_OR_INVALID_STATE');
      end if;
      insert into public.notifications (user_id, title, body, kind)
      values (p_target_user_id, 'Account suspended',
        'Your account has been suspended by an administrator.', 'error');

    when 'reactivate_user' then
      update public.profiles
         set status = 'approved', suspended_at = null
       where id = p_target_user_id and status = 'suspended';
      if not found then
        return jsonb_build_object('ok', false, 'error', 'NOT_FOUND_OR_INVALID_STATE');
      end if;
      insert into public.notifications (user_id, title, body, kind, link)
      values (p_target_user_id, 'Account reactivated',
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

    else
      return jsonb_build_object('ok', false, 'error', 'UNKNOWN_ACTION');
  end case;

  insert into public.audit_logs (action, actor_id, target_user_id, meta)
  values (
    case p_action
      when 'approve_user' then 'USER_APPROVED'
      when 'reject_user' then 'USER_REJECTED'
      when 'suspend_user' then 'USER_SUSPENDED'
      when 'reactivate_user' then 'USER_REACTIVATED'
      when 'archive_user' then 'USER_ARCHIVED'
      else 'PERMISSION_CHANGED'
    end,
    v_actor, p_target_user_id,
    jsonb_build_object('admin_action', p_action, 'payload', p_payload));

  return jsonb_build_object('ok', true);
end;
$$;
grant execute on function public.admin_user_action(text, uuid, jsonb) to authenticated, service_role;

-- ============================================================================
-- 15. TRIGGERS — profile lifecycle + updated_at stamps
-- ============================================================================

-- Auto-create a profile on signup: first account = admin + approved,
-- everyone after = pending member (§5 — the two-level user model).
create or replace function public.handle_new_user()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  v_count integer;
  v_ign text;
begin
  select count(*) into v_count from public.profiles;
  v_ign := coalesce(
    nullif(new.raw_user_meta_data->>'ign', ''),
    split_part(new.email, '@', 1),
    'player'
  );
  v_ign := left(v_ign, 32);

  -- De-duplicate: ign is unique — collision must not crash auth signup.
  if exists (select 1 from public.profiles where ign = v_ign) then
    declare
      v_n integer := 1;
    begin
      while exists (select 1 from public.profiles where ign = v_ign || '-' || v_n)
        loop v_n := v_n + 1; end loop;
      v_ign := left(v_ign || '-' || v_n, 32);
    end;
  end if;

  insert into public.profiles (id, ign, status, is_platform_admin)
  values (
    new.id,
    v_ign,
    case when v_count = 0 then 'approved' else 'pending' end,
    v_count = 0
  )
  on conflict (id) do nothing;
  return new;
end;
$$;

drop trigger if exists on_auth_user_created on auth.users;
create trigger on_auth_user_created
  after insert on auth.users
  for each row execute function public.handle_new_user();

create or replace function public.touch_updated_at()
returns trigger
language plpgsql
set search_path = public
as $$
begin
  new.updated_at := now();
  return new;
end;
$$;

drop trigger if exists on_profiles_update on public.profiles;
create trigger on_profiles_update before update on public.profiles
  for each row execute function public.touch_updated_at();

drop trigger if exists on_events_update on public.events;
create trigger on_events_update before update on public.events
  for each row execute function public.touch_updated_at();

-- ============================================================================
-- 16. REALTIME — event signup + status changes (§36)
-- ============================================================================
do $$
begin
  if exists (select 1 from pg_publication where pubname = 'supabase_realtime') then
    if not exists (select 1 from pg_publication_tables
      where pubname = 'supabase_realtime' and schemaname = 'public' and tablename = 'event_signups') then
      alter publication supabase_realtime add table public.event_signups;
    end if;
    if not exists (select 1 from pg_publication_tables
      where pubname = 'supabase_realtime' and schemaname = 'public' and tablename = 'events') then
      alter publication supabase_realtime add table public.events;
    end if;
  end if;
end
$$;


-- ============================================================
-- ALBION ONLINE EQUIPMENT SEED
-- ============================================================
-- This is a normalized equipment-family seed.
-- tier = 'any' means the application does not restrict the
-- equipment selector to a specific tier.
--
-- IMPORTANT:
-- This is a practical catalog for the event/signup system,
-- not a replacement for a complete official item database.
-- ============================================================

INSERT INTO public.albion_equipment
    (name, category, family, tier, source)
VALUES

-- ============================================================
-- WEAPONS — SWORDS
-- ============================================================

('Broadsword','Weapon','Swords','any','seed'),
('Claymore','Weapon','Swords','any','seed'),
('Dual Swords','Weapon','Swords','any','seed'),
('Carving Sword','Weapon','Swords','any','seed'),
('Clarent Blade','Weapon','Swords','any','seed'),
('Kingmaker','Weapon','Swords','any','seed'),
('Infinity Blade','Weapon','Swords','any','seed'),
('Galatine Pair','Weapon','Swords','any','seed'),


-- ============================================================
-- WEAPONS — AXES
-- ============================================================

('Battleaxe','Weapon','Axes','any','seed'),
('Greataxe','Weapon','Axes','any','seed'),
('Halberd','Weapon','Axes','any','seed'),
('Infernal Scythe','Weapon','Axes','any','seed'),
('Carrioncaller','Weapon','Axes','any','seed'),
('Realmbreaker','Weapon','Axes','any','seed'),
('Crystal Reaper','Weapon','Axes','any','seed'),
('Bear Paws','Weapon','Axes','any','seed'),


-- ============================================================
-- WEAPONS — MACES
-- ============================================================

('Mace','Weapon','Maces','any','seed'),
('Heavy Mace','Weapon','Maces','any','seed'),
('Morning Star','Weapon','Maces','any','seed'),
('Incubus Mace','Weapon','Maces','any','seed'),
('Camlann Mace','Weapon','Maces','any','seed'),
('Bedrock Mace','Weapon','Maces','any','seed'),
('Oathkeepers','Weapon','Maces','any','seed'),
('Dreadstorm Monarch','Weapon','Maces','any','seed'),


-- ============================================================
-- WEAPONS — HAMMERS
-- ============================================================

('Hammer','Weapon','Hammers','any','seed'),
('Great Hammer','Weapon','Hammers','any','seed'),
('Polehammer','Weapon','Hammers','any','seed'),
('Tombhammer','Weapon','Hammers','any','seed'),
('Grovekeeper','Weapon','Hammers','any','seed'),
('Forge Hammers','Weapon','Hammers','any','seed'),
('Hand of Justice','Weapon','Hammers','any','seed'),
('Truebolt Hammer','Weapon','Hammers','any','seed'),


-- ============================================================
-- WEAPONS — SPEARS
-- ============================================================

('Spear','Weapon','Spears','any','seed'),
('Pike','Weapon','Spears','any','seed'),
('Glaive','Weapon','Spears','any','seed'),
('Heron Spear','Weapon','Spears','any','seed'),
('Trinity Spear','Weapon','Spears','any','seed'),
('Spirithunter','Weapon','Spears','any','seed'),
('Rift Glaive','Weapon','Spears','any','seed'),
('Daybreaker','Weapon','Spears','any','seed'),


-- ============================================================
-- WEAPONS — QUARTERSTAFFS
-- ============================================================

('Quarterstaff','Weapon','Quarterstaffs','any','seed'),
('Double-Bladed Staff','Weapon','Quarterstaffs','any','seed'),
('Black Monk Stave','Weapon','Quarterstaffs','any','seed'),
('Staff of Balance','Weapon','Quarterstaffs','any','seed'),
('Ironclad Staff','Weapon','Quarterstaffs','any','seed'),
('Soulscythe','Weapon','Quarterstaffs','any','seed'),
('Phantom Twinblade','Weapon','Quarterstaffs','any','seed'),
('Grailseeker','Weapon','Quarterstaffs','any','seed'),


-- ============================================================
-- WEAPONS — DAGGERS
-- ============================================================

('Dagger','Weapon','Daggers','any','seed'),
('Dagger Pair','Weapon','Daggers','any','seed'),
('Claws','Weapon','Daggers','any','seed'),
('Bloodletter','Weapon','Daggers','any','seed'),
('Deathgivers','Weapon','Daggers','any','seed'),
('Black Hands','Weapon','Daggers','any','seed'),
('Twin Slayers','Weapon','Daggers','any','seed'),
('Bridled Fury','Weapon','Daggers','any','seed'),


-- ============================================================
-- WEAPONS — BOWS
-- ============================================================

('Bow','Weapon','Bows','any','seed'),
('Warbow','Weapon','Bows','any','seed'),
('Longbow','Weapon','Bows','any','seed'),
('Whispering Bow','Weapon','Bows','any','seed'),
('Bow of Badon','Weapon','Bows','any','seed'),
('Wailing Bow','Weapon','Bows','any','seed'),
('Mistpiercer','Weapon','Bows','any','seed'),
('Skystrider Bow','Weapon','Bows','any','seed'),


-- ============================================================
-- WEAPONS — CROSSBOWS
-- ============================================================

('Crossbow','Weapon','Crossbows','any','seed'),
('Light Crossbow','Weapon','Crossbows','any','seed'),
('Heavy Crossbow','Weapon','Crossbows','any','seed'),
('Weeping Repeater','Weapon','Crossbows','any','seed'),
('Siegebow','Weapon','Crossbows','any','seed'),
('Boltcasters','Weapon','Crossbows','any','seed'),
('Arclight Blasters','Weapon','Crossbows','any','seed'),
('Energy Shaper','Weapon','Crossbows','any','seed'),


-- ============================================================
-- WEAPONS — FIRE STAFFS
-- ============================================================

('Fire Staff','Weapon','Fire Staffs','any','seed'),
('Great Fire Staff','Weapon','Fire Staffs','any','seed'),
('Infernal Staff','Weapon','Fire Staffs','any','seed'),
('Wildfire Staff','Weapon','Fire Staffs','any','seed'),
('Blazing Staff','Weapon','Fire Staffs','any','seed'),
('Brimstone Staff','Weapon','Fire Staffs','any','seed'),
('Flamewalker Staff','Weapon','Fire Staffs','any','seed'),
('Dawnsong','Weapon','Fire Staffs','any','seed'),


-- ============================================================
-- WEAPONS — FROST STAFFS
-- ============================================================

('Frost Staff','Weapon','Frost Staffs','any','seed'),
('Great Frost Staff','Weapon','Frost Staffs','any','seed'),
('Glacial Staff','Weapon','Frost Staffs','any','seed'),
('Permafrost Prism','Weapon','Frost Staffs','any','seed'),
('Hoarfrost Staff','Weapon','Frost Staffs','any','seed'),
('Icicle Staff','Weapon','Frost Staffs','any','seed'),
('Chillhowl','Weapon','Frost Staffs','any','seed'),
('Arctic Staff','Weapon','Frost Staffs','any','seed'),


-- ============================================================
-- WEAPONS — ARCANE STAFFS
-- ============================================================

('Arcane Staff','Weapon','Arcane Staffs','any','seed'),
('Great Arcane Staff','Weapon','Arcane Staffs','any','seed'),
('Occult Staff','Weapon','Arcane Staffs','any','seed'),
('Malevolent Locus','Weapon','Arcane Staffs','any','seed'),
('Witchwork Staff','Weapon','Arcane Staffs','any','seed'),
('Enigmatic Staff','Weapon','Arcane Staffs','any','seed'),
('Astral Staff','Weapon','Arcane Staffs','any','seed'),
('Evensong','Weapon','Arcane Staffs','any','seed'),


-- ============================================================
-- WEAPONS — HOLY STAFFS
-- ============================================================

('Holy Staff','Weapon','Holy Staffs','any','seed'),
('Great Holy Staff','Weapon','Holy Staffs','any','seed'),
('Divine Staff','Weapon','Holy Staffs','any','seed'),
('Fallen Staff','Weapon','Holy Staffs','any','seed'),
('Hallowfall','Weapon','Holy Staffs','any','seed'),
('Lifetouch Staff','Weapon','Holy Staffs','any','seed'),
('Redemption Staff','Weapon','Holy Staffs','any','seed'),
('Exalted Staff','Weapon','Holy Staffs','any','seed'),


-- ============================================================
-- WEAPONS — NATURE STAFFS
-- ============================================================

('Nature Staff','Weapon','Nature Staffs','any','seed'),
('Great Nature Staff','Weapon','Nature Staffs','any','seed'),
('Druidic Staff','Weapon','Nature Staffs','any','seed'),
('Blight Staff','Weapon','Nature Staffs','any','seed'),
('Rampant Staff','Weapon','Nature Staffs','any','seed'),
('Wild Staff','Weapon','Nature Staffs','any','seed'),
('Ironroot Staff','Weapon','Nature Staffs','any','seed'),
('Forgebark Staff','Weapon','Nature Staffs','any','seed'),


-- ============================================================
-- WEAPONS — CURSED STAFFS
-- ============================================================

('Cursed Staff','Weapon','Cursed Staffs','any','seed'),
('Great Cursed Staff','Weapon','Cursed Staffs','any','seed'),
('Demonic Staff','Weapon','Cursed Staffs','any','seed'),
('Cursed Skull','Weapon','Cursed Staffs','any','seed'),
('Damnation Staff','Weapon','Cursed Staffs','any','seed'),
('Lifecurse Staff','Weapon','Cursed Staffs','any','seed'),
('Shadowcaller','Weapon','Cursed Staffs','any','seed'),
('Rotcaller Staff','Weapon','Cursed Staffs','any','seed'),


-- ============================================================
-- WEAPONS — WAR GLOVES
-- ============================================================

('Brawler Gloves','Weapon','War Gloves','any','seed'),
('Battle Bracers','Weapon','War Gloves','any','seed'),
('Spiked Gauntlets','Weapon','War Gloves','any','seed'),
('Ursine Maulers','Weapon','War Gloves','any','seed'),
('Hellfire Hands','Weapon','War Gloves','any','seed'),
('Ravenstrike Cestus','Weapon','War Gloves','any','seed'),
('Fists of Avalon','Weapon','War Gloves','any','seed'),
('Forcepulse Bracers','Weapon','War Gloves','any','seed'),


-- ============================================================
-- WEAPONS — SHAPESHIFTER STAFFS
-- ============================================================

('Prowling Staff','Weapon','Shapeshifter Staffs','any','seed'),
('Rootbound Staff','Weapon','Shapeshifter Staffs','any','seed'),
('Primal Staff','Weapon','Shapeshifter Staffs','any','seed'),
('Bloodmoon Staff','Weapon','Shapeshifter Staffs','any','seed'),
('Hellspawn Staff','Weapon','Shapeshifter Staffs','any','seed'),
('Earthrune Staff','Weapon','Shapeshifter Staffs','any','seed'),
('Lightcaller','Weapon','Shapeshifter Staffs','any','seed'),
('Stillgaze Staff','Weapon','Shapeshifter Staffs','any','seed'),


-- ============================================================
-- ARMOR — CLOTH CHEST
-- ============================================================

('Scholar Robe','Chest','Cloth','any','seed'),
('Cleric Robe','Chest','Cloth','any','seed'),
('Royal Robe','Chest','Cloth','any','seed'),
('Druid Robe','Chest','Cloth','any','seed'),
('Fiend Robe','Chest','Cloth','any','seed'),
('Feyscale Robe','Chest','Cloth','any','seed'),
('Purity Robe','Chest','Cloth','any','seed'),
('Cultist Robe','Chest','Cloth','any','seed'),


-- ============================================================
-- ARMOR — LEATHER CHEST
-- ============================================================

('Mercenary Jacket','Chest','Leather','any','seed'),
('Hunter Jacket','Chest','Leather','any','seed'),
('Assassin Jacket','Chest','Leather','any','seed'),
('Stalker Jacket','Chest','Leather','any','seed'),
('Hellion Jacket','Chest','Leather','any','seed'),
('Specter Jacket','Chest','Leather','any','seed'),
('Royal Jacket','Chest','Leather','any','seed'),
('Mistwalker Jacket','Chest','Leather','any','seed'),


-- ============================================================
-- ARMOR — PLATE CHEST
-- ============================================================

('Soldier Armor','Chest','Plate','any','seed'),
('Knight Armor','Chest','Plate','any','seed'),
('Guardian Armor','Chest','Plate','any','seed'),
('Graveguard Armor','Chest','Plate','any','seed'),
('Judicator Armor','Chest','Plate','any','seed'),
('Demon Armor','Chest','Plate','any','seed'),
('Royal Armor','Chest','Plate','any','seed'),
('Duskweaver Armor','Chest','Plate','any','seed'),


-- ============================================================
-- HELMETS — CLOTH
-- ============================================================

('Mage Cowl','Head','Cloth','any','seed'),
('Cleric Cowl','Head','Cloth','any','seed'),
('Scholar Cowl','Head','Cloth','any','seed'),
('Fiend Cowl','Head','Cloth','any','seed'),
('Royal Cowl','Head','Cloth','any','seed'),
('Druid Cowl','Head','Cloth','any','seed'),
('Cultist Cowl','Head','Cloth','any','seed'),


-- ============================================================
-- HELMETS — LEATHER
-- ============================================================

('Hunter Hood','Head','Leather','any','seed'),
('Mercenary Hood','Head','Leather','any','seed'),
('Assassin Hood','Head','Leather','any','seed'),
('Stalker Hood','Head','Leather','any','seed'),
('Hellion Hood','Head','Leather','any','seed'),
('Specter Hood','Head','Leather','any','seed'),
('Royal Hood','Head','Leather','any','seed'),


-- ============================================================
-- HELMETS — PLATE
-- ============================================================

('Soldier Helmet','Head','Plate','any','seed'),
('Knight Helmet','Head','Plate','any','seed'),
('Guardian Helmet','Head','Plate','any','seed'),
('Graveguard Helmet','Head','Plate','any','seed'),
('Judicator Helmet','Head','Plate','any','seed'),
('Demon Helmet','Head','Plate','any','seed'),
('Royal Helmet','Head','Plate','any','seed'),


-- ============================================================
-- SHOES — CLOTH
-- ============================================================

('Mage Sandals','Feet','Cloth','any','seed'),
('Cleric Sandals','Feet','Cloth','any','seed'),
('Scholar Sandals','Feet','Cloth','any','seed'),
('Fiend Sandals','Feet','Cloth','any','seed'),
('Royal Sandals','Feet','Cloth','any','seed'),
('Druid Sandals','Feet','Cloth','any','seed'),


-- ============================================================
-- SHOES — LEATHER
-- ============================================================

('Hunter Shoes','Feet','Leather','any','seed'),
('Mercenary Shoes','Feet','Leather','any','seed'),
('Assassin Shoes','Feet','Leather','any','seed'),
('Stalker Shoes','Feet','Leather','any','seed'),
('Hellion Shoes','Feet','Leather','any','seed'),
('Specter Shoes','Feet','Leather','any','seed'),
('Royal Shoes','Feet','Leather','any','seed'),


-- ============================================================
-- SHOES — PLATE
-- ============================================================

('Soldier Boots','Feet','Plate','any','seed'),
('Knight Boots','Feet','Plate','any','seed'),
('Guardian Boots','Feet','Plate','any','seed'),
('Graveguard Boots','Feet','Plate','any','seed'),
('Judicator Boots','Feet','Plate','any','seed'),
('Demon Boots','Feet','Plate','any','seed'),
('Royal Boots','Feet','Plate','any','seed'),


-- ============================================================
-- OFF-HANDS — TOMES
-- ============================================================

('Tome of Spells','Off-Hand','Tomes','any','seed'),
('Muisak','Off-Hand','Tomes','any','seed'),
('Eye of Secrets','Off-Hand','Tomes','any','seed'),
('Timelocked Grimoire','Off-Hand','Tomes','any','seed'),


-- ============================================================
-- OFF-HANDS — SHIELDS
-- ============================================================

('Shield','Off-Hand','Shields','any','seed'),
('Sarcophagus','Off-Hand','Shields','any','seed'),
('Facebreaker','Off-Hand','Shields','any','seed'),
('Caitiff Shield','Off-Hand','Shields','any','seed'),
('Astral Aegis','Off-Hand','Shields','any','seed'),
('Unbreakable Ward','Off-Hand','Shields','any','seed'),


-- ============================================================
-- OFF-HANDS — TORCHES
-- ============================================================

('Torch','Off-Hand','Torches','any','seed'),
('Mistcaller','Off-Hand','Torches','any','seed'),
('Leering Cane','Off-Hand','Torches','any','seed'),
('Cryptcandle','Off-Hand','Torches','any','seed'),
('Blueflame Torch','Off-Hand','Torches','any','seed'),
('Sacred Scepter','Off-Hand','Torches','any','seed'),


-- ============================================================
-- OFF-HANDS — NATURE / ARCANE SPECIALIZED
-- ============================================================

('Taproot','Off-Hand','Specialized Off-Hands','any','seed'),

-- ============================================================
-- MOUNTS — RIDING (per official wiki: family entries keep tier
-- prefixes out; members pick their own tier)
-- ============================================================

('Riding Horse','Mount','Horses','any','seed'),
('Armored Horse','Mount','Horses','any','seed'),
('Warhorse','Mount','Horses','any','seed'),
('Gallant Horse','Mount','Horses','any','seed'),
('Mule','Mount','Transport','any','seed'),
('Transport Ox','Mount','Transport','any','seed'),
('Transport Mammoth','Mount','Transport','any','seed'),
('Giant Stag','Mount','Gathering & Utility','any','seed'),
('Moose','Mount','Gathering & Utility','any','seed'),
('Winter Bear','Mount','Gathering & Utility','any','seed'),
('Grizzly Bear','Mount','Gathering & Utility','any','seed'),
('Wild Boar','Mount','Gathering & Utility','any','seed'),
('Terrorbird','Mount','Gathering & Utility','any','seed'),
('Bighorn Ram','Mount','Gathering & Utility','any','seed'),
('Swiftclaw','Mount','Dire','any','seed'),
('Direwolf','Mount','Dire','any','seed'),
('Greywolf','Mount','Dire','any','seed'),
('Snow Husky','Mount','Dire','any','seed'),
('Direboar','Mount','Dire','any','seed'),
('Direbear','Mount','Dire','any','seed'),
('Swamp Dragon','Mount','Dire','any','seed'),
('Pest Lizard','Mount','Dire','any','seed'),
('Spectral Bat','Mount','Spectral','any','seed'),
('Spectral Bonehorse','Mount','Spectral','any','seed'),
('Spectral Direboar','Mount','Spectral','any','seed'),
('Morgana Raven','Mount','Seasonal & Special','any','seed'),
('Morgana Nightmare','Mount','Seasonal & Special','any','seed'),
('Frost Ram','Mount','Seasonal & Special','any','seed'),
('Black Panther','Mount','Seasonal & Special','any','seed'),
('Rageclaw','Mount','Seasonal & Special','any','seed'),
('Divine Owl','Mount','Seasonal & Special','any','seed'),
('Mystic Owl','Mount','Seasonal & Special','any','seed'),
('Moabird','Mount','Seasonal & Special','any','seed'),
('Swamp Salamander','Mount','Seasonal & Special','any','seed'),
('Caerleon Cottontail','Mount','Seasonal & Special','any','seed'),
('Heretic Combat Mule','Mount','Faction & Battle','any','seed'),
('Battle Rhino','Mount','Faction & Battle','any','seed'),

-- ============================================================
-- MOUNTS — BATTLE MOUNTS (the ZvZ roster; each has Silver/Gold/
-- Crystal variants — members bring their own tier/quality)
-- ============================================================

('Command Mammoth','Mount','Battle Mounts','any','seed'),
('Ancient Ent','Mount','Battle Mounts','any','seed'),
('Battle Eagle','Mount','Battle Mounts','any','seed'),
('Behemoth','Mount','Battle Mounts','any','seed'),
('Colossus Beetle','Mount','Battle Mounts','any','seed'),
('Goliath Horseeater','Mount','Battle Mounts','any','seed'),
('Juggernaut','Mount','Battle Mounts','any','seed'),
('Phalanx Beetle','Mount','Battle Mounts','any','seed'),
('Roving Bastion','Mount','Battle Mounts','any','seed'),
('Siege Ballista','Mount','Battle Mounts','any','seed'),
('Tower Chariot','Mount','Battle Mounts','any','seed'),
('Flame Basilisk','Mount','Battle Mounts','any','seed'),
('Venom Basilisk','Mount','Battle Mounts','any','seed'),
('Avalonian Basilisk','Mount','Battle Mounts','any','seed'),

-- ============================================================
-- CAPES (families — any tier)
-- ============================================================

('Cape','Cape','Standard Capes','any','seed'),
('Avalonian Cape','Cape','Artifact Capes','any','seed'),
('Undead Cape','Cape','Artifact Capes','any','seed'),
('Demon Cape','Cape','Artifact Capes','any','seed'),
('Heretic Cape','Cape','Artifact Capes','any','seed'),
('Keeper Cape','Cape','Artifact Capes','any','seed'),
('Morgana Cape','Cape','Artifact Capes','any','seed'),
('Thetford Cape','Cape','City Capes','any','seed'),
('Fort Sterling Cape','Cape','City Capes','any','seed'),
('Lymhurst Cape','Cape','City Capes','any','seed'),
('Bridgewatch Cape','Cape','City Capes','any','seed'),
('Martlock Cape','Cape','City Capes','any','seed'),
('Caerleon Cape','Cape','City Capes','any','seed'),
('Brecilien Cape','Cape','City Capes','any','seed'),
('Smuggler Cape','Cape','City Capes','any','seed'),

-- ============================================================
-- BAGS (families — any tier)
-- ============================================================

('Bag','Bag','Standard Bags','any','seed'),
('Satchel of Insight','Bag','Artifact Bags','any','seed'),
('Avalonian Bag','Bag','Artifact Bags','any','seed')


ON CONFLICT (name) DO NOTHING;


-- ============================================================================
-- DONE. Verify with:  npm run db:push && npm run db:doctor
-- ============================================================================
