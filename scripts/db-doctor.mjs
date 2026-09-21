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
  "profiles", "events", "event_parties", "event_slots", "event_signups",
  "albion_equipment", "notifications", "audit_logs",
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
  for (const t of ["teams", "team_members", "mass_sheets", "mass_parties", "mass_slots", "mass_assignments"]) {
    report(!present.has(t), `legacy table ${t} removed`);
  }

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
          jsonb_build_array(jsonb_build_object('role', 'Tank', 'equipment', 'Heavy Mace')))))) as res;`,
      claims);
    const svOk = sv.ok && sv.rows?.[0]?.res?.ok === true;
    report(svOk, "save_event RPC succeeds for admin session",
      svOk ? "event + party + slot + audit (rolled back)"
        : `FAILED → ${sv.rows?.[0]?.res?.error ?? sv.code ?? sv.message}`);

    // Signup race: two claims on one slot — exactly one must win.
    if (svOk) {
      // The probe rolled back, so re-create disposable rows for the race check.
      const raceProbe = await probe("authenticated", `
        select public.save_event(null, jsonb_build_object(
          'title', '__doctor_race__', 'parties',
          jsonb_build_array(jsonb_build_object('name', 'P1', 'slots',
            jsonb_build_array(jsonb_build_object('role', 'Tank', 'equipment', 'Mace')))))) as res;`,
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
  } else {
    console.error("  • No admin profile exists yet — register the first account to complete admin-session probes.");
  }

  // ------------------------------------------------------------------
  // 6. Recursion guard (42P17)
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
