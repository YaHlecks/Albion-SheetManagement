-- ============================================================================
-- 0003 — SLOT EQUIPMENT REQUIREMENTS (composable) + equipment taxonomy upgrade
--
-- For databases that already ran the ORIGINAL 0001 (pre-revamp): upgrades the
-- model in place. On a fresh database 0001 already creates these objects and
-- this migration detects that and does nothing destructive (all idempotent).
--
-- Model: a slot row = a spreadsheet row. Requirements are 0..n rows in
-- event_slot_requirements with full-taxonomy categories:
--   Weapon · Head · Chest · Feet · Off-Hand · Mount · Cape · Bag · Other
-- ============================================================================

-- 1. Requirements table ------------------------------------------------------
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

-- 2. Migrate the legacy single `equipment` column into requirement rows ------
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
      and lower(trim(equipment)) <> 'tbd'
    on conflict do nothing;

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

-- 3. Equipment taxonomy upgrade: Armor→Chest, Helmet→Head, Shoes→Feet ---------
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

-- 4. New catalog families: Mounts (incl. the battle-mount roster), Capes, Bags
--    (all names verified against the official Albion Online wiki)
insert into public.albion_equipment (name, category, family, tier, source)
values
  -- Mounts — riding / transport / utility
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
  -- Mounts — battle mounts (Silver/Gold/Crystal variants exist in game)
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
  -- Capes
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
  -- Bags
  ('Bag','Bag','Standard Bags','any','seed'),
  ('Satchel of Insight','Bag','Artifact Bags','any','seed'),
  ('Avalonian Bag','Bag','Artifact Bags','any','seed')
on conflict (name) do nothing;

-- 5. RLS + grants + realtime visibility for the new table --------------------
alter table public.event_slot_requirements enable row level security;

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

revoke all on public.event_slot_requirements from anon;
grant select on public.event_slot_requirements to authenticated;
revoke insert, update, delete, truncate, references, trigger
  on public.event_slot_requirements from authenticated;
grant select, insert, update, delete, truncate on public.event_slot_requirements to service_role;

do $$
begin
  if exists (select 1 from pg_publication where pubname = 'supabase_realtime') then
    if not exists (select 1 from pg_publication_tables
      where pubname = 'supabase_realtime' and schemaname = 'public' and tablename = 'event_slot_requirements') then
      alter publication supabase_realtime add table public.event_slot_requirements;
    end if;
  end if;
end
$$;

-- ============================================================================
-- DONE. Verify with:  npm run db:push && npm run db:doctor
-- ============================================================================
