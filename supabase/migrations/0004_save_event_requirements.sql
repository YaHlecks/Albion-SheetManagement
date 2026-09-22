-- ============================================================================
-- 0004 — SAVE_EVENT / DUPLICATE_EVENT FOR THE REQUIREMENTS MODEL
--
-- WHY THIS EXISTS: migration 0003 dropped event_slots.equipment but left the
-- original save_event/duplicate_event bodies in place. On any database that
-- ran the ORIGINAL 0001, those old bodies still insert into the dropped
-- `equipment` column → every admin save fails with 42703 (undefined column) —
-- "Save Draft is broken" even though the frontend is correct.
--
-- On a FRESH database 0001 already defines the new bodies; this file is
-- idempotent (create or replace) and re-applies them harmlessly.
--
-- After running: verify with `npm run db:doctor` — it now asserts that
-- save_event's body actually references event_slot_requirements.
-- ============================================================================

-- ============================================================================
-- save_event — one atomic transaction for the whole sheet.
-- ============================================================================
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

-- ============================================================================
-- duplicate_event — copy structure (incl. requirement rows), never signups.
-- ============================================================================
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

-- Re-assert grants (create or replace does not change privileges, this is belt
-- and braces in case a stale DB drifted).
grant execute on function public.save_event(uuid, jsonb) to authenticated, service_role;
grant execute on function public.duplicate_event(uuid) to authenticated, service_role;

-- ============================================================================
-- DONE. Verify with:  npm run db:push && npm run db:doctor
-- ============================================================================
