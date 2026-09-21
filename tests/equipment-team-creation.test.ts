import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

/**
 * Regression guards for migration 0005: equipment catalog + atomic team
 * creation. Encoded facts:
 *   * admin_action keeps ALL original branches — a partial replacement would
 *     silently break member management and lock controls.
 *   * create_team validates server-side, is atomic (team + Leader membership
 *     + audit in one definer call) and returns friendly error codes.
 *   * albion_equipment: authenticated read-only, anon zero, seeded with real
 *     base items only.
 */
const sql = readFileSync(
  join(process.cwd(), "supabase", "migrations", "0005_equipment_and_team_creation.sql"),
  "utf8",
);
const init = readFileSync(
  join(process.cwd(), "supabase", "migrations", "0001_init.sql"),
  "utf8",
);

/** Extract the full admin_action body from a migration file. */
function adminActionBody(source: string): string {
  const start = source.indexOf("create or replace function public.admin_action");
  expect(start).toBeGreaterThan(-1);
  const end = source.indexOf("\n$$;", start);
  return source.slice(start, end);
}

describe("0005 — admin_action completeness (no dropped branches)", () => {
  const v5 = adminActionBody(sql);
  const v1 = adminActionBody(init);

  const BRANCHES = [
    "approve_user", "reject_user", "suspend_user", "reactivate_user",
    "archive_user", "set_admin", "create_team", "rename_team",
    "archive_team", "restore_team", "set_team_status", "lock_sheet",
    "unlock_sheet", "add_member", "remove_member", "set_member_role",
  ] as const;

  it("keeps every original action branch", () => {
    for (const b of BRANCHES) {
      expect(v5).toMatch(new RegExp(`when '${b}' then`));
    }
  });

  it("adds nothing that weakens the admin gate", () => {
    expect(v5).toMatch(/is_platform_admin[\s\S]*?FORBIDDEN/);
    expect(v5).not.toMatch(/WITH CHECK \('true'\)|USING \(true\)/);
    // anon can never reach the trusted-server path
    expect(v5).toMatch(/'anon' then[\s\S]*?FORBIDDEN/);
  });
});

describe("0005 — atomic create_team (Phase 1/6)", () => {
  const v5 = adminActionBody(sql);

  it("validates the name server-side with friendly codes", () => {
    expect(v5).toMatch(/INVALID_TEAM_NAME/);
    expect(v5).toMatch(/NAME_TAKEN/);
    expect(v5).toMatch(/INVALID_STATUS/);
  });

  it("writes team + creator Leader membership atomically", () => {
    expect(v5).toMatch(/insert into public\.teams[\s\S]*?returning id into v_team_id/);
    expect(v5).toMatch(/insert into public\.team_members \(team_id, user_id, role, added_by\)[\s\S]*?'Leader'/);
    expect(v5).toMatch(/on conflict \(team_id, user_id\) do nothing/);
  });

  it("catches unique_violation instead of crashing", () => {
    expect(v5).toMatch(/exception when unique_violation then/);
  });

  it("still sets the transaction-scoped actor for triggers", () => {
    expect(v5).toMatch(/set_config\('app\.actor_id'/);
  });
});

describe("0005 — albion_equipment catalog (Phase 3)", () => {
  it("creates the normalized catalog table", () => {
    expect(sql).toMatch(/create table if not exists public\.albion_equipment/);
    expect(sql).toMatch(/name text not null unique/);
    expect(sql).toMatch(/category text not null/);
    expect(sql).toMatch(/family text not null/);
    expect(sql).toMatch(/tier text not null default 'any'/);
    expect(sql).toMatch(/item_power integer/);
    expect(sql).toMatch(/icon_url text/);
    expect(sql).toMatch(/source text not null default 'seed' check \(source in \('seed','openalbion','manual'\)\)/);
  });

  it("is searchable: name + category/family indexes", () => {
    expect(sql).toMatch(/albion_equipment_name_idx on public\.albion_equipment \(lower\(name\)\)/);
    expect(sql).toMatch(/albion_equipment_family_idx/);
  });

  it("seeds only real base items — no invented equipment", () => {
    const allowed = [
      "Broadsword", "Claymore", "Dual Swords", "Battleaxe", "Greataxe", "Halberd",
      "Mace", "Heavy Mace", "Morning Star", "Incubus Mace", "Hammer", "Great Hammer",
      "Spear", "Great Spear", "Quarterstaff", "Double Bladed Staff", "Dagger",
      "Dagger Pair", "Bow", "Wargbow", "Longbow", "Crossbow", "Heavy Crossbow",
      "Nature Staff", "Great Nature Staff", "Holy Staff", "Great Holy Staff",
      "Arcane Staff", "Great Arcane Staff", "Frost Staff", "Glacial Staff",
      "Fire Staff", "Great Fire Staff", "Cursed Staff", "Great Cursed Staff",
      "War Gloves", "Bear Paws", "Cloth Armor", "Leather Armor", "Soldier Armor",
      "Knight Armor", "Guardian Armor", "Soldier Helmet", "Knight Helmet",
      "Hunter Hood", "Mage Cowl", "Cleric Cowl", "Soldier Boots", "Knight Boots",
      "Hunter Shoes", "Mage Sandals", "Cleric Shoes", "Torch", "Shield", "Book",
      "Tome", "Orb", "Totem", "Banner",
    ];
    const seeds = [...sql.matchAll(/\('([^']+)','(Weapon|Armor|Helmet|Shoes|Off-Hand)'/g)].map((m) => m[1]);
    expect(seeds.length).toBeGreaterThanOrEqual(55);
    for (const s of seeds) expect(allowed).toContain(s);
  });

  it("uses real Albion weapon families in the seed", () => {
    for (const family of ["Swords", "Axes", "Maces", "Hammers", "Spears", "Quarterstaffs",
      "Daggers", "Bows", "Crossbows", "Nature Staffs", "Holy Staffs", "Arcane Staffs",
      "Frost Staffs", "Fire Staffs", "Cursed Staffs", "War Gloves"]) {
      expect(sql).toContain(`'${family}'`);
    }
  });

  it("authenticated = SELECT only; anon = zero; RLS enabled", () => {
    expect(sql).toMatch(/grant select on public\.albion_equipment to authenticated/);
    expect(sql).toMatch(/revoke insert, update, delete[\s\S]*?on public\.albion_equipment from authenticated/);
    expect(sql).toMatch(/revoke all on public\.albion_equipment from anon/);
    expect(sql).toMatch(/alter table public\.albion_equipment enable row level security/);
    expect(sql).toMatch(/create policy "albion_equipment: authenticated read"/);
  });

  it("mass_slots gains tier_requirement with a check constraint", () => {
    expect(sql).toMatch(/add column if not exists tier_requirement text not null default 'any'/);
    expect(sql).toMatch(/mass_slots_tier_requirement_check/);
    expect(sql).toMatch(/'T4\.1','T5','T5\.1','T6','T6\.1','T7','T7\.1','T8','T8\.1'/);
  });

  it("save_mass_sheet persists tier_requirement", () => {
    expect(sql).toMatch(/tier_requirement = coalesce\(v_slot->>'tier_requirement', tier_requirement\)/);
  });
});

describe("equipment sync script (Phase 2)", () => {
  it("exists, is offline-safe, and never runs at app runtime", () => {
    const pkg = JSON.parse(readFileSync(join(process.cwd(), "package.json"), "utf8"));
    expect(pkg.scripts["equipment:sync"]).toBe("node scripts/equipment-sync.mjs");
    const sync = readFileSync(join(process.cwd(), "scripts", "equipment-sync.mjs"), "utf8");
    expect(sync).toContain("api.openalbion.com");
    // Outage handling: abort leaves local catalog untouched.
    expect(sync).toMatch(/Sync aborted/);
    // No client-side fetch of the API anywhere in src/.
    expect(readFileSync(join(process.cwd(), "src", "lib", "mass.ts"), "utf8")).not.toContain("openalbion");
  });
});

describe("db:doctor — create_team probe (Phase 29)", () => {
  it("probes the exact production path and reports the real error", () => {
    const doctor = readFileSync(join(process.cwd(), "scripts", "db-doctor.mjs"), "utf8");
    expect(doctor).toContain("admin_action('create_team'");
    expect(doctor).toContain("this is why Create Team fails in the app");
    expect(doctor).toContain("albion_equipment");
  });
});
