import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

/**
 * Static consistency checks over the authoritative schema (0001_init.sql).
 * These guard the security-critical invariants whose violation previously
 * caused 42P17 recursion and 42501 permission errors — a future edit cannot
 * silently reintroduce them.
 */
const sql = readFileSync(join(process.cwd(), "supabase", "migrations", "0001_init.sql"), "utf8");

const TABLES = [
  "profiles", "events", "event_parties", "event_slots", "event_slot_requirements",
  "event_signups", "albion_equipment", "notifications", "audit_logs",
];

describe("schema — tables & constraints", () => {
  it("creates all eight event-architecture tables", () => {
    for (const t of TABLES) {
      expect(sql).toMatch(new RegExp(`create table if not exists public\\.${t}`));
    }
  });

  it("chains events → parties → slots → requirements → signups with cascading FKs", () => {
    expect(sql).toMatch(/event_parties\s*\([\s\S]*?event_id uuid not null references public\.events\(id\) on delete cascade/);
    expect(sql).toMatch(/event_slots\s*\([\s\S]*?party_id uuid not null references public\.event_parties\(id\) on delete cascade/);
    expect(sql).toMatch(/event_slot_requirements\s*\([\s\S]*?slot_id uuid not null references public\.event_slots\(id\) on delete cascade/);
    expect(sql).toMatch(/event_signups\s*\([\s\S]*?slot_id uuid not null unique references public\.event_slots\(id\)/);
    expect(sql).toMatch(/event_signups\s*\([\s\S]*?event_id uuid not null references public\.events\(id\)/);
  });

  it("slots are spreadsheet rows with COMPOSABLE requirements (§7/§8)", () => {
    const reqTable = sql.match(/create table if not exists public\.event_slot_requirements[\s\S]*?\);/)![0];
    for (const cat of ["Weapon", "Head", "Chest", "Feet", "Off-Hand", "Mount", "Cape", "Bag", "Other"]) {
      expect(reqTable).toContain(`'${cat}'`);
    }
    // A slot no longer has a single equipment column — the old rigid model.
    const slotTable = sql.match(/create table if not exists public\.event_slots[\s\S]*?\);/)![0];
    expect(slotTable).not.toMatch(/\bequipment\b/);
  });

  it("enforces one-signup-per-slot AND one-signup-per-member-per-event", () => {
    expect(sql).toMatch(/slot_id uuid not null unique/);
    expect(sql).toMatch(/unique \(event_id, user_id\)/);
  });

  it("save_event writes requirement rows transactionally (0..n per slot)", () => {
    const fn = sql.match(/function public\.save_event[\s\S]*?\$\$;/)![0];
    expect(fn).toMatch(/event_slot_requirements/);
    expect(fn).toMatch(/delete from public\.event_slot_requirements where slot_id = v_slot_id/);
    expect(fn).toMatch(/coalesce\(jsonb_array_length\(v_slot->'requirements'\), 0\)/);
  });

  it("duplicate_event copies requirement rows, never signups", () => {
    const fn = sql.match(/function public\.duplicate_event[\s\S]*?\$\$;/)![0];
    expect(fn).toMatch(/into public\.event_slot_requirements/);
    expect(fn).not.toMatch(/event_signups/);
  });

  it("uses the smallest sensible event lifecycle (§7)", () => {
    expect(sql).toMatch(/status in \('draft','published','locked','completed','cancelled','archived'\)/);
  });

  it("supports templates (§15)", () => {
    expect(sql).toMatch(/is_template boolean not null default false/);
  });

  it("notifications use `kind` — the UI never selects a `type` column", () => {
    const table = sql.match(/create table if not exists public\.notifications[\s\S]*?\);/)![0];
    expect(table).toMatch(/kind text/);
    expect(table).not.toMatch(/\btype\b/);
  });
});

describe("schema — no Team architecture remains (§46)", () => {
  it("contains zero team tables, functions, or policies", () => {
    expect(sql).not.toMatch(/create table if not exists public\.teams?\b/);
    expect(sql).not.toMatch(/create table if not exists public\.team_members/);
    expect(sql).not.toMatch(/team_members\b/);
    expect(sql).not.toMatch(/create or replace function public\.admin_action\b/);
    expect(sql).not.toMatch(/claim_mass_slot|save_mass_sheet|mass_sheets|mass_parties/);
  });
});

describe("RLS — enabled, scoped, recursion-safe (§33/§39)", () => {
  it("enables RLS on every table", () => {
    for (const t of TABLES) {
      expect(sql).toMatch(new RegExp(`alter table public\\.${t}\\s+enable row level security`));
    }
  });

  it("never uses USING (true) / WITH CHECK (true)", () => {
    expect(sql).not.toMatch(/USING \(true\)/i);
    expect(sql).not.toMatch(/WITH CHECK \(true\)/i);
  });

  it("visibility cascades through security-definer helpers (42P17-safe)", () => {
    expect(sql).toMatch(/function public\.is_event_visible[\s\S]*?security definer/);
    expect(sql).toMatch(/create policy "events: visible read"[\s\S]*?using \(public\.is_event_visible\(id\)\)/);
    expect(sql).toMatch(/create policy "event_slots: visible read"[\s\S]*?using \(public\.is_event_slot_visible\(id\)\)/);
    expect(sql).toMatch(/create policy "event_signups: visible read"[\s\S]*?using \(public\.is_event_slot_visible\(slot_id\)\)/);
  });

  it("members write only their own signups, on published events only", () => {
    expect(sql).toMatch(/create policy "event_signups: own row on published"[\s\S]*?user_id = auth\.uid\(\)[\s\S]*?e\.status = 'published'/);
  });

  it("drafts and templates are admin-only", () => {
    expect(sql).toMatch(/is_event_visible[\s\S]*?e\.status in \('published','locked','completed'\)/);
  });

  it("notifications: members read + mark-read own; admins insert", () => {
    expect(sql).toMatch(/create policy "notifications: own read"[\s\S]*?using \(user_id = auth\.uid\(\)\)/);
    expect(sql).toMatch(/create policy "notifications: admin insert"[\s\S]*?with check \(public\.is_event_admin\(\)\)/);
  });

  it("audit_logs is append-only and admin-readable", () => {
    expect(sql).toMatch(/create policy "audit_logs: admin read"[\s\S]*?using \(public\.is_event_admin\(\)\)/);
    expect(sql).toMatch(/create policy "audit_logs: admin insert"[\s\S]*?with check \(public\.is_event_admin\(\)\)/);
  });

  it("no policy self-references its own table (recursion guard)", () => {
    const policies = sql.split(/create policy /).slice(1);
    for (const p of policies) {
      const name = p.match(/"([^"]+)"/)?.[1] ?? "?";
      const body = p.slice(p.indexOf("using"));
      for (const t of TABLES) {
        if (name.includes(t)) {
          expect(body, `policy "${name}" must not read public.${t}`).not.toContain(`from public.${t}`);
        }
      }
    }
  });
});

describe("grants — authenticated SELECT-only, anon zero (§33)", () => {
  it("revokes everything from anon", () => {
    expect(sql.match(/revoke all on public\.\w+\s+from anon;/g)?.length).toBeGreaterThanOrEqual(8);
  });

  it("grants authenticated SELECT on all tables and nothing else", () => {
    const grantBlock = sql.match(/grant select on public\.profiles,[\s\S]*?to authenticated;/)![0];
    for (const t of TABLES) {
      expect(grantBlock).toContain(t);
    }
    expect(sql).toMatch(/revoke insert, update, delete, truncate, references, trigger[\s\S]*?from authenticated/);
  });

  it("service_role keeps full access (server-only)", () => {
    expect(sql).toMatch(/grant select, insert, update, delete, truncate[\s\S]*?to service_role/);
  });

  it("grants EXECUTE on every RPC to authenticated", () => {
    for (const fn of [
      "claim_event_slot\\(uuid, text\\)",
      "leave_event_slot\\(uuid\\)",
      "save_event\\(uuid, jsonb\\)",
      "set_event_status\\(uuid, text\\)",
      "duplicate_event\\(uuid\\)",
      "admin_set_signup\\(uuid, uuid\\)",
      "admin_user_action\\(text, uuid, jsonb\\)",
      "update_own_profile\\(text, text\\)",
    ]) {
      expect(sql).toMatch(new RegExp(`grant execute on function public\\.${fn}\\s+to authenticated`));
    }
  });
});

describe("RPCs — signup concurrency and admin flows (§10/§34)", () => {
  it("claim re-checks approval + published status in-database", () => {
    expect(sql).toMatch(/function public\.claim_event_slot[\s\S]*?ACCOUNT_NOT_APPROVED/);
    expect(sql).toMatch(/function public\.claim_event_slot[\s\S]*?EVENT_NOT_OPEN/);
    expect(sql).toMatch(/function public\.claim_event_slot[\s\S]*?ALREADY_SIGNED_UP/);
  });

  it("claim uses the profile IGN — members never retype it (§11)", () => {
    expect(sql).toMatch(/claim_event_slot[\s\S]*?p\.ign, v_note/);
  });

  it("maps unique_violation races to SLOT_TAKEN / ALREADY_SIGNED_UP", () => {
    expect(sql).toMatch(/claim_event_slot[\s\S]*?when unique_violation then[\s\S]*?SLOT_TAKEN/);
  });

  it("identity always comes from auth.uid(), never the client", () => {
    const fn = sql.match(/function public\.claim_event_slot[\s\S]*?\$\$;/)![0];
    expect(fn).not.toMatch(/p_user_id/);
  });

  it("publish notifies approved members (§17)", () => {
    expect(sql).toMatch(/set_event_status[\s\S]*?insert into public\.notifications[\s\S]*?p\.status = 'approved'/);
  });

  it("duplicate copies structure, never signups, starts as draft (§15/§17)", () => {
    const fn = sql.match(/function public\.duplicate_event[\s\S]*?\$\$;/)![0];
    expect(fn).toMatch(/'draft', false, v_actor/);
    expect(fn).not.toMatch(/event_signups/);
  });

  it("first account bootstraps admin+approved; later ones pending (§5)", () => {
    expect(sql).toMatch(/case when v_count = 0 then 'approved' else 'pending' end,\s*\n\s*v_count = 0/);
  });

  it("profile creation de-duplicates IGN instead of crashing auth signup", () => {
    expect(sql).toMatch(/handle_new_user[\s\S]*?v_ign \|\| '-' \|\| v_n/);
  });

  it("missing profile row can never silently succeed a signup", () => {
    expect(sql).toMatch(/claim_event_slot[\s\S]*?PROFILE_NOT_FOUND/);
  });

  it("admin_set_signup(null) removes the signup occupying the slot (no silent no-op)", () => {
    const fn = sql.match(/function public\.admin_set_signup[\s\S]*?\$\$;/)![0];
    expect(fn).toMatch(/p_user_id is null then[\s\S]*?select \* into v_old from public\.event_signups where slot_id = p_slot_id/);
    expect(fn).toMatch(/p_user_id is null then[\s\S]*?delete from public\.event_signups where slot_id = p_slot_id/);
  });

  it("save_event rejects edits to a nonexistent event instead of silently no-oping", () => {
    const fn = sql.match(/function public\.save_event[\s\S]*?\$\$;/)![0];
    expect(fn).toMatch(/error', 'NOT_FOUND'/);
  });
});

describe("equipment catalog (§18–25)", () => {
  it("is normalized with searchable indexes", () => {
    expect(sql).toMatch(/create table if not exists public\.albion_equipment/);
    expect(sql).toMatch(/albion_equipment_name_idx on public\.albion_equipment \(lower\(name\)\)/);
    expect(sql).toMatch(/albion_equipment_family_idx/);
  });

  it("covers all weapon families, armor slots, off-hands, mounts, capes and bags", () => {
    for (const family of ["Swords", "Axes", "Maces", "Hammers", "Spears", "Quarterstaffs",
      "Daggers", "Bows", "Crossbows", "Fire Staffs", "Frost Staffs", "Arcane Staffs",
      "Holy Staffs", "Nature Staffs", "Cursed Staffs", "War Gloves", "Shapeshifter Staffs"]) {
      expect(sql).toContain(`'${family}'`);
    }
    for (const item of ["Cryptcandle", "Mistcaller", "Taproot", "Facebreaker", "Leering Cane", "Shield", "Tome of Spells"]) {
      expect(sql).toContain(`'${item}'`);
    }
    for (const cat of ["'Weapon'", "'Head'", "'Chest'", "'Feet'", "'Off-Hand'", "'Mount'", "'Cape'", "'Bag'"]) {
      expect(sql).toContain(cat);
    }
  });

  it("seeds the battle-mount roster from the official wiki", () => {
    for (const mount of ["Command Mammoth", "Ancient Ent", "Battle Eagle", "Behemoth",
      "Colossus Beetle", "Goliath Horseeater", "Juggernaut", "Phalanx Beetle",
      "Roving Bastion", "Siege Ballista", "Tower Chariot", "Flame Basilisk",
      "Venom Basilisk", "Avalonian Basilisk", "Tower Chariot", "Warhorse", "Swiftclaw",
      "Direwolf", "Transport Ox", "Giant Stag"]) {
      expect(sql).toContain(`'${mount}'`);
    }
  });

  it("does not re-add the legacy equipment categories", () => {
    for (const cat of ["'Armor'", "'Helmet'", "'Shoes'"]) {
      expect(sql).not.toContain(`'${cat}'`);
    }
  });

  it("tier_requirement is structured and CHECK-constrained", () => {
    expect(sql).toMatch(/tier_requirement in \('any','T4','T4\.1','T5','T5\.1','T6','T6\.1','T7','T7\.1','T8','T8\.1'\)/);
  });

  it("has no item in two families (Black Hands is a Dagger, not also War Gloves)", () => {
    const names = [...sql.matchAll(/\('([^']+)'\s*,\s*'[^']+'\s*,\s*'[^']+'\s*,\s*'[^']+'\s*,\s*'seed'\)/g)].map((m) => m[1]);
    const dupes = names.filter((n, i) => names.indexOf(n) !== i);
    expect(dupes).toEqual([]);
  });

  it("weapon families match the current Albion weapon tree", () => {
    for (const family of ["Swords", "Axes", "Maces", "Hammers", "Spears", "Quarterstaffs", "Daggers", "Bows", "Crossbows", "Fire Staffs", "Frost Staffs", "Arcane Staffs", "Holy Staffs", "Nature Staffs", "Cursed Staffs", "War Gloves", "Shapeshifter Staffs"]) {
      expect(sql).toContain(`'${family}'`);
    }
  });
});

describe("realtime + reset (§36/§37)", () => {
  it("publishes signups and events for realtime", () => {
    expect(sql).toMatch(/alter publication supabase_realtime add table public\.event_signups/);
    expect(sql).toMatch(/alter publication supabase_realtime add table public\.events/);
  });

  it("event_slot_requirements follows slot visibility (RLS)", () => {
    expect(sql).toMatch(/create policy "event_slot_requirements: visible read"[\s\S]*?using \(public\.is_event_slot_visible\(slot_id\)\)/);
    expect(sql).toMatch(/create policy "event_slot_requirements: admins write"/);
  });

  it("reset script drops everything except auth.users and is idempotent", () => {
    const reset = readFileSync(join(process.cwd(), "supabase", "reset.sql"), "utf8");
    expect(reset).toMatch(/drop table if exists public\.events cascade/);
    expect(reset).toMatch(/drop table if exists public\.teams cascade/);
    expect(reset).not.toMatch(/drop table if exists auth\.users/);
    expect(reset).toMatch(/auth\.users is INTENTIONALLY PRESERVED/);
  });
});
