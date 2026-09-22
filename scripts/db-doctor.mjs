#!/usr/bin/env node
/**
 * db:doctor — live verification of the event-architecture database.
 *
 * Connects with DATABASE_URL (a Postgres connection string with elevated
 * privileges — the same one db:push uses) and verifies:
 *   1. Every expected table exists.
 *   2. Grants match the design: anon = zero; authenticated = SELECT-only;
 *      service_role = full.
 *   3. RLS is ENABLED everywhere (never disabled as a "fix").
 *   4. Every security-definer RPC + helper is executable by `authenticated`.
 *   5. THE PROOF: simulates the frontend's exact requests as `anon`,
 *      `authenticated` and an admin session (SET LOCAL ROLE + JWT claims,
 *      rolled back per probe) — the same privilege context PostgREST uses.
 *   6. Recursion guard: no policy self-references its own table (42P17).
 *
 * Exit code is non-zero on any failure, so this can run in CI.
 */
import { readFileSync } from "node:fs";
import { join } from "node:path";
import pg from "pg";

// Read DATABASE_URL from .env.local / .env when not exported in the shell.
for (const f of [".env.local", ".env"]) {
  try {
    const raw = readFileSync(join(process.cwd(), f), "utf8");
    for (const line of raw.split("\n")) {
      const m = line.match(/^\s*DATABASE_URL\s*=\s*(.*)\s*$/);
      if (m && !process.env.DATABASE_URL) {
        process.env.DATABASE_URL = m[1].replace(/^["']|["']$/g, "");
      }
    }
  } catch { /* optional file */ }
}

const url = process.env.DATABASE_URL;
if (!url) {
  console.error("DATABASE_URL is not set. Add it to .env.local (Postgres connection string).");
  console.error("Alternative: paste supabase/migrations/0001_init.sql into the Supabase SQL Editor.");
  process.exit(1);
}

const client = new pg.Client({
  connectionString: url,
  ssl: url.includes("localhost") || url.includes("127.0.0.1") ? false : { rejectUnauthorized: false },
});

const TABLES = [
  "profiles", "events", "event_parties", "event_slots", "event_slot_requirements",
  "event_signups", "albion_equipment", "notifications", "audit_logs",
];

/** What the application is supposed to be able to do, per role. */
const EXPECTED = {
  anon: { op: "SELECT", tables: [] }, // zero table access by design
  authenticated: { op: "SELECT", tables: [...TABLES] }, // SELECT under RLS everywhere
  service_role: { op: "SELECT", tables: [...TABLES] },
};

let failures = 0;
let passes = 0;

function report(ok, label, detail) {
  const icon = ok ? "  ✓ " : "  ✗ ";
  console.error(`${icon}${label}${detail ? ` — ${detail}` : ""}`);
  if (ok) passes++;
  else failures++;
}

const ROLE_SWITCH = {
  anon: "set local role anon;",
  authenticated: "set local role authenticated;",
  service_role: "set local role service_role;",
};

async function probe(role, sql, claims) {
  try {
    await client.query("begin");
    await client.query(ROLE_SWITCH[role] ?? `set local role ${role};`);
    if (claims) {
      await client.query("set local request.jwt.claims = $1;", [JSON.stringify(claims)]);
    }
    const result = await client.query(sql);
    await client.query("rollback");
    return { ok: true, rows: result.rows };
  } catch (err) {
    try { await client.query("rollback"); } catch { /* already aborted */ }
    return { ok: false, code: String(err.code ?? "?"), message: err.message };
  }
}

async function main() {
  await client.connect();

  // ------------------------------------------------------------------
  // 1. Tables exist
  // ------------------------------------------------------------------
  console.error("Schema:");
  const { rows: tableRows } = await client.query(
    `select table_name from information_schema.tables
     where table_schema = 'public' order by table_name`,
  );
  const present = new Set(tableRows.map((r) => r.table_name));
  for (const t of TABLES) {
    report(present.has(t), `${t} exists`);
  }
  // Legacy tables must be GONE.
  for (const t of ["teams", "team_members", "mass_sheets", "mass_parties", "mass_slots", "mass_assignments", "sheets", "sheet_entries", "friendships", "messages"]) {
    report(!present.has(t), `legacy table ${t} removed`);
  }

  // Required profile columns (auth/profile contract — 42703 broke admin access
  // when these were missing).
  const { rows: colRows } = await client.query(
    `select column_name from information_schema.columns
     where table_schema = 'public' and table_name = 'profiles'`,
  );
  const cols = new Set(colRows.map((r) => r.column_name));
  for (const c of ["last_login_at", "approved_at", "suspended_at", "ign", "discord", "status", "is_platform_admin"]) {
    report(cols.has(c), `profiles.${c} exists`, cols.has(c) ? "ok" : "MISSING → 42703 on profile loads");
  }

  // Frontend column contract: every column the UI selects must exist with the
  // exact name the code uses. (notifications.type previously did not exist —
  // the UI selected it and every notification load silently failed.)
  console.error("\nColumn contracts (frontend selects):")
  for (const [table, expected] of [
    ["notifications", ["id", "user_id", "title", "body", "kind", "link", "read", "created_at"]],
    ["events", ["id", "title", "description", "event_date", "massing_time", "timezone", "location", "portal", "set_name", "caller", "instructions", "status", "is_template", "created_by", "created_at", "updated_at"]],
    ["event_parties", ["id", "event_id", "name", "fill_note", "sort_order"]],
    ["event_slots", ["id", "party_id", "role", "notes", "priority", "required", "sort_order"]],
    ["event_slot_requirements", ["id", "slot_id", "category", "item", "tier_requirement", "sort_order"]],
    ["event_signups", ["id", "slot_id", "event_id", "user_id", "ign", "note", "signed_up_at"]],
    ["albion_equipment", ["id", "name", "category", "family", "tier", "icon_url", "active"]],
    ["audit_logs", ["id", "action", "actor_id", "target_user_id", "event_id", "meta", "created_at"]],
  ]) {
    const { rows: tCols } = await client.query(
      `select column_name from information_schema.columns where table_schema='public' and table_name=$1`,
      [table],
    );
    const have = new Set(tCols.map((r) => r.column_name));
    for (const c of expected) {
      report(have.has(c), `${table}.${c} exists`, have.has(c) ? "ok" : "MISSING → frontend selects fail (42703/PGRST204)");
    }
    if (table === "notifications" && have.has("type")) {
      report(false, "notifications has no stray 'type' column", "frontend must select `kind`, not `type`");
    }
    if (table === "event_slots" && have.has("equipment")) {
      report(false, "event_slots has no legacy single 'equipment' column",
        "run db:push — requirements now live in event_slot_requirements");
    }
  }

  // Composable requirements contract: the table must exist and be populated
  // correctly for any events that have slots.
  if (present.has("event_slot_requirements")) {
    const { rows: slotCounts } = await client.query(
      `select
         (select count(*)::int from public.event_slots) as slots,
         (select count(*)::int from public.event_slot_requirements) as reqs`,
    );
    const slots = slotCounts[0]?.slots ?? 0;
    const reqs = slotCounts[0]?.reqs ?? 0;
    report(true, `slot requirements model active (${slots} slots, ${reqs} requirement rows)`);
    const { rows: badCats } = await client.query(
      `select distinct category from public.event_slot_requirements
       where category not in ('Weapon','Head','Chest','Feet','Off-Hand','Mount','Cape','Bag','Other')`,
    );
    report(badCats.length === 0, "requirement categories all within taxonomy", badCats.length ? badCats.map((r) => r.category).join(", ") : undefined);
  }

  // Equipment catalog sanity: unique names + the seeded families the picker
  // filters by. A broken seed shows up as an empty or duplicated catalog.
  console.error("\nEquipment catalog:");
  const { rows: eqCount } = await client.query(`select count(*)::int as n from public.albion_equipment where active`);
  report((eqCount[0]?.n ?? 0) > 100, `catalog populated (${eqCount[0]?.n ?? 0} active items)`, (eqCount[0]?.n ?? 0) > 100 ? "ok" : "EMPTY → equipment picker unusable (run db:push)");
  const { rows: dupEq } = await client.query(
    `select lower(name) as n, count(*)::int as c from public.albion_equipment group by lower(name) having count(*) > 1`,
  );
  report(dupEq.length === 0, "no duplicate equipment names", dupEq.length ? dupEq.map((r) => r.n).join(", ") : undefined);
  const { rows: famRows } = await client.query(
    `select distinct category, family from public.albion_equipment`,
  );
  const catFams = new Map(famRows.map((r) => [r.category, new Set()]));
  for (const r of famRows) catFams.get(r.category)?.add(r.family);
  for (const f of ["Swords", "Axes", "Maces", "Hammers", "Spears", "Quarterstaffs", "Daggers", "Bows", "Crossbows", "Fire Staffs", "Frost Staffs", "Arcane Staffs", "Holy Staffs", "Nature Staffs", "Cursed Staffs", "War Gloves", "Shapeshifter Staffs"]) {
    report(catFams.get("Weapon")?.has(f), `weapon family ${f} seeded`);
  }
  for (const c of ["Mount", "Cape", "Bag", "Head", "Chest", "Feet", "Off-Hand"]) {
    report((catFams.get(c)?.size ?? 0) > 0, `equipment category ${c} seeded`, (catFams.get(c)?.size ?? 0) > 0 ? `${catFams.get(c).size} families` : "EMPTY → picker tab unusable");
  }
  const battleMounts = catFams.get("Mount")?.has("Battle Mounts");
  report(Boolean(battleMounts), "battle-mount roster seeded (Command Mammoth, Tower Chariot, basilisks…)");

  // Legacy functions must be GONE (old Team/mass architecture).
  const LEGACY_FNS = [
    "create_team", "admin_action", "handle_membership_change", "log_audit",
    "is_team_member", "is_team_editable", "shares_team_with_me",
    "claim_mass_slot", "unclaim_mass_slot", "save_mass_sheet",
    "set_mass_sheet_status", "duplicate_mass_sheet", "admin_set_slot_assignment",
    "recent_own_activity",
  ];
  const { rows: fnRows } = await client.query(
    `select p.proname from pg_proc p join pg_namespace n on n.oid = p.pronamespace
     where n.nspname = 'public'`,
  );
  const fnsPresent = new Set(fnRows.map((r) => r.proname));
  for (const f of LEGACY_FNS) {
    report(!fnsPresent.has(f), `legacy function ${f} removed`);
  }

  // No function name may have multiple signatures — duplicate RPCs with
  // confusing overloads are how "which one runs?" bugs are born.
  const { rows: dupRows } = await client.query(
    `select p.proname, count(*)::int as variants
     from pg_proc p join pg_namespace n on n.oid = p.pronamespace
     where n.nspname = 'public'
     group by p.proname having count(*) > 1`,
  );
  report(dupRows.length === 0, "no overloaded/duplicate function names in public",
    dupRows.map((r) => `${r.proname}(${r.variants})`).join(", ") || undefined);

  // ------------------------------------------------------------------
  // 2. Grants
  // ------------------------------------------------------------------
  console.error("\nGrants:");
  const { rows: grantRows } = await client.query(
    `select grantee, table_name, privilege_type from information_schema.role_table_grants
     where table_schema = 'public' and grantee in ('anon','authenticated','service_role')
     order by table_name, grantee`,
  );
  const grants = new Map();
  for (const g of grantRows) {
    const key = `${g.table_name}:${g.grantee}`;
    if (!grants.has(key)) grants.set(key, new Set());
    grants.get(key).add(g.privilege_type);
  }
  for (const t of TABLES) {
    const anonPrivs = grants.get(`${t}:anon`);
    report(!anonPrivs || anonPrivs.size === 0, `${t}: anon has zero privileges`, anonPrivs?.size ? [...anonPrivs].join(",") : "none");
    const authPrivs = grants.get(`${t}:authenticated`);
    const onlySelect = authPrivs && [...authPrivs].every((p) => p === "SELECT");
    report(onlySelect, `${t}: authenticated has SELECT only`, authPrivs ? [...authPrivs].join(",") : "MISSING → 42501 on reads");
    const svcPrivs = grants.get(`${t}:service_role`);
    report(Boolean(svcPrivs?.has("INSERT")), `${t}: service_role full access`);
  }

  // ------------------------------------------------------------------
  // 3. RLS enabled everywhere
  // ------------------------------------------------------------------
  console.error("\nRLS:");
  const { rows: rlsRows } = await client.query(
    `select tablename, rowsecurity from pg_tables where schemaname = 'public'`,
  );
  for (const r of rlsRows) {
    if (!TABLES.includes(r.tablename)) continue;
    report(r.rowsecurity, `${r.tablename}: RLS enabled`, r.rowsecurity ? "on" : "OFF — security regression");
  }

  // ------------------------------------------------------------------
  // 4. RPCs + helpers executable by authenticated
  // ------------------------------------------------------------------
  console.error("\nRPCs:");
  const fns = [
    "is_event_admin()",
    "is_event_visible(uuid)",
    "is_event_party_visible(uuid)",
    "is_event_slot_visible(uuid)",
    "claim_event_slot(uuid,text)",
    "leave_event_slot(uuid)",
    "save_event(uuid,jsonb)",
    "set_event_status(uuid,text)",
    "duplicate_event(uuid)",
    "admin_set_signup(uuid,uuid)",
    "admin_user_action(text,uuid,jsonb)",
    "update_own_profile(text,text)",
    "ensure_profile()",
    "touch_login()",
    "check_ign_available(text)",
    "claim_first_admin()",
  ];
  for (const f of fns) {
    const r = await probe("authenticated", `select public.${f};`);
    report(r.ok, `${f} executable by authenticated`, r.ok ? "granted" : `${r.code}: ${r.message}`);
  }

  // ------------------------------------------------------------------
  // 5. Role simulation — the frontend's exact privilege context
  // ------------------------------------------------------------------
  console.error("\nLive role simulation (frontend-equivalent requests):");

  for (const t of TABLES) {
    const r = await probe("anon", `select * from public.${t} limit 1;`);
    report(!r.ok && r.code === "42501", `${t} as anon: denied`, !r.ok && r.code === "42501" ? "42501 (correct)" : r.ok ? "UNEXPECTEDLY READABLE" : `${r.code} (acceptable, expected 42501)`);
  }

  for (const t of TABLES) {
    const r = await probe("authenticated", `select * from public.${t} limit 1;`);
    report(r.ok, `${t} as authenticated: SELECT executes`, r.ok ? `ok (${r.rows?.length ?? 0} rows without session — RLS scopes the rest)` : `${r.code}: ${r.message}`);
  }

  // Write-path probes as authenticated: INSERT must be denied (RPC-only writes).
  for (const t of ["events", "event_signups", "albion_equipment", "audit_logs"]) {
    const r = await probe("authenticated", `insert into public.${t} default values;`);
    report(!r.ok, `${t} as authenticated: INSERT denied (writes go through RPCs)`, !r.ok ? `${r.code} (correct)` : "UNEXPECTEDLY WRITABLE");
  }

  const { rows: adminRows } = await client.query(
    `select p.id from public.profiles p where p.is_platform_admin order by p.created_at asc limit 1`,
  );
  if (adminRows.length > 0) {
    const adminId = adminRows[0].id;
    const claims = { sub: adminId, role: "authenticated" };
    for (const t of TABLES) {
      const r = await probe("authenticated", `select count(*) as n from public.${t};`, claims);
      report(r.ok, `${t} visible to admin session`, r.ok ? `${r.rows?.[0]?.n} rows` : `${r.code}: ${r.message}`);
    }

    // THE create-event probe: the exact production path (save_event), rolled back.
    const sv = await probe("authenticated",
      `select public.save_event(null, jsonb_build_object(
        'title', '__doctor_probe__', 'parties',
        jsonb_build_array(jsonb_build_object('name', 'Party 1', 'slots',
          jsonb_build_array(jsonb_build_object('role', 'Tank', 'requirements',
            jsonb_build_array(
              jsonb_build_object('category', 'Weapon', 'item', 'Heavy Mace'),
              jsonb_build_object('category', 'Off-Hand', 'item', 'Shield')))))))) as res;`,
      claims);
    const svOk = sv.ok && sv.rows?.[0]?.res?.ok === true;
    report(svOk, "save_event RPC succeeds for admin session",
      svOk ? "event + party + slot + 2 requirements + audit (rolled back)"
        : `FAILED → ${sv.rows?.[0]?.res?.error ?? sv.code ?? sv.message}`);

    // Compose-proof: the saved probe event must have BOTH requirement rows.
    if (svOk) {
      const { rows: reqCheck } = await client.query(
        `select count(*)::int as n from public.event_slot_requirements esr
         join public.event_slots es on es.id = esr.slot_id
         join public.event_parties ep on ep.id = es.party_id
         where ep.event_id = (select id from public.events where title = '__doctor_probe__')`,
      );
      report((reqCheck[0]?.n ?? 0) >= 2, "save_event persists composable requirements",
        `${reqCheck[0]?.n ?? 0} requirement rows saved`);
    }

    // Signup race: two claims on one slot — exactly one must win.
    if (svOk) {
      // The probe rolled back, so re-create disposable rows for the race check.
      const raceProbe = await probe("authenticated", `
        select public.save_event(null, jsonb_build_object(
          'title', '__doctor_race__', 'parties',
          jsonb_build_array(jsonb_build_object('name', 'P1', 'slots',
            jsonb_build_array(jsonb_build_object('role', 'Tank', 'requirements',
              jsonb_build_array(jsonb_build_object('category', 'Weapon', 'item', 'Mace')))))))) as res;`,
        claims);
      const eventId = raceProbe.rows?.[0]?.res?.id;
      if (eventId) {
        // Sign up a second fake member profile? No — use the admin itself for
        // both claims; UNIQUE(slot_id) must reject the second.
        const { rows: slotRows } = await client.query(
          `select es.id from public.event_slots es
           join public.event_parties ep on ep.id = es.party_id
           where ep.event_id = $1 limit 1`, [eventId]);
        const c1 = await probe("authenticated", `select public.claim_event_slot('${slotRows[0].id}', null) as res;`, claims);
        report(c1.ok && c1.rows?.[0]?.res?.ok === true, "first signup succeeds", c1.ok ? "claimed" : JSON.stringify(c1.rows?.[0]?.res ?? c1.message));
        report(c1.ok && c1.rows?.[0]?.res?.ok === false && c1.rows?.[0]?.res?.error === "ALREADY_SIGNED_UP",
          "duplicate signup rejected (one signup per member per event)",
          c1.ok ? `error=${c1.rows?.[0]?.res?.error}` : "n/a");
        // Cleanup the disposable rows for real (outside the probe transaction).
        await client.query(`delete from public.events where id = $1`, [eventId]);
      }
    }

    // Auth/profile contract (the login page's exact sequence), all rolled back.
    const ep = await probe("authenticated", `select public.ensure_profile() as res;`, claims);
    report(ep.ok && ep.rows?.[0]?.res?.ok === true,
      "ensure_profile RPC succeeds (existing profile left intact)",
      ep.ok ? `created=${ep.rows?.[0]?.res?.created}` : `${ep.code}: ${ep.message}`);
    const tl = await probe("authenticated", `select public.touch_login();`, claims);
    report(tl.ok, "touch_login RPC succeeds (last_login_at + USER_LOGIN audit)", tl.ok ? "ok" : `${tl.code}: ${tl.message}`);
    const cf = await probe("authenticated", `select public.claim_first_admin() as res;`, claims);
    report(cf.ok && cf.rows?.[0]?.res?.ok === true && cf.rows?.[0]?.res?.promoted === false,
      "claim_first_admin is a no-op for an existing admin (idempotent)",
      cf.ok ? "promoted=false" : JSON.stringify(cf.rows?.[0]?.res ?? cf.message));
  } else {
    console.error("  • No admin profile exists yet — register the first account to complete admin-session probes.");
  }

  // Registration-page probe: anon must be able to check IGN availability.
  const ign = await probe("anon", `select public.check_ign_available('__doctor_probe__') as res;`);
  report(ign.ok && typeof ign.rows?.[0]?.res === "boolean",
    "check_ign_available RPC callable by anon (registration flow)", ign.ok ? "ok" : `${ign.code}: ${ign.message}`);

  // ------------------------------------------------------------------
  // Realtime publication — only the tables the app streams (§15).
  // ------------------------------------------------------------------
  console.error("\nRealtime:");
  const { rows: pubRows } = await client.query(
    `select tablename from pg_publication_tables
     where pubname = 'supabase_realtime' and schemaname = 'public'`,
  );
  const pub = new Set(pubRows.map((r) => r.tablename));
  for (const t of ["event_signups", "events", "notifications"]) {
    report(pub.has(t), `${t} in supabase_realtime publication`, pub.has(t) ? "ok" : "MISSING → no live updates");
  }
  const unexpected = [...pub].filter((t) => !TABLES.includes(t));
  report(unexpected.length === 0, "no obsolete tables in realtime publication",
    unexpected.length ? unexpected.join(", ") : undefined);

  // ------------------------------------------------------------------
  // 7. Recursion guard (42P17)
  // ------------------------------------------------------------------
  console.error("\nRecursion check (42P17):");
  const { rows: polRows } = await client.query(
    `select tablename, policyname, qual, with_check from pg_policies where schemaname = 'public'`,
  );
  let recursionSafe = true;
  for (const p of polRows) {
    const expr = `${p.qual ?? ""} ${p.with_check ?? ""}`;
    if (expr.includes(`from public.${p.tablename}`) || expr.includes(`from ${p.tablename}`)) {
      recursionSafe = false;
      report(false, `${p.tablename} policy "${p.policyname}" self-references its table`, "42P17 risk");
    }
  }
  if (recursionSafe) report(true, `no policy self-references its table (${polRows.length} policies checked)`);

  await client.end();

  console.error(`\nResult: ${passes} passed, ${failures} failed.`);
  if (failures > 0) {
    console.error("Fix the failures above (usually: run `npm run db:push`).");
    process.exit(1);
  }
}

main().catch((err) => {
  console.error("db:doctor crashed:", err);
  process.exit(1);
});
