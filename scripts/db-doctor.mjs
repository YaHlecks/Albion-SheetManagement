#!/usr/bin/env node
/**
 * db:doctor — proves the live database authorization state by SIMULATING the
 * frontend's exact requests as the roles the application actually uses
 * (anon / authenticated), instead of the SQL editor's elevated privileges.
 *
 *   npm run db:doctor
 *
 * Requires DATABASE_URL (Supabase → Project Settings → Database → URI).
 *
 * For every protected table it answers the only two questions that matter:
 *   1. GRANT layer:   can the role execute the operation at all?  (42501)
 *   2. RLS layer:     which rows survive the policies?            (row counts)
 *
 * Exit code is non-zero if any EXPECTED permission is missing — i.e. the
 * exact class of error seen in production ("42501 permission denied for
 * table team_members / audit_logs") is detectable in CI before the app runs.
 *
 * Safe to run against production: read-only, everything inside transactions
 * that roll back, and probes use SET LOCAL ROLE so nothing is written.
 */
import { readFileSync, readdirSync } from "node:fs";
import { join } from "node:path";

const url = process.env.DATABASE_URL;
if (!url) {
  console.error(
    "DATABASE_URL is not set.\n" +
      "Set it to your Postgres connection string (Supabase → Project Settings → Database)\n" +
      "and run `npm run db:doctor` again."
  );
  process.exit(1);
}

let Client;
try {
  ({ Client } = await import("pg"));
} catch {
  console.error("The 'pg' package is not installed. Run:\n  npm install --no-save pg\nThen re-run npm run db:doctor.");
  process.exit(1);
}

const client = new Client({
  connectionString: url,
  ssl: url.includes("localhost") || url.includes("127.0.0.1") ? false : { rejectUnauthorized: false },
});

const TABLES = ["profiles", "teams", "team_members", "notifications", "audit_logs",
  "mass_sheets", "mass_parties", "mass_slots", "mass_assignments"];
const MASS_TABLES = ["mass_sheets", "mass_parties", "mass_slots", "mass_assignments"];

/** What the application is supposed to be able to do, per role. */
const EXPECTED = {
  anon: { op: "SELECT", tables: [] }, // zero table access by design
  authenticated: { op: "SELECT", tables: [...TABLES] }, // SELECT under RLS everywhere
  service_role: { op: "SELECT", tables: [...TABLES] },
};

let failures = 0;
let passes = 0;

function report(ok, label, detail) {
  if (ok) passes += 1;
  else failures += 1;
  const icon = ok ? "  ✓ " : "  ✗ ";
  console.error(`${icon}${label}${detail ? ` — ${detail}` : ""}`);
}

/**
 * Probe one operation as one role. Runs in a rolled-back transaction with
 * SET LOCAL ROLE so the probe exactly reproduces PostgREST's privilege
 * context (request.jwt.claims supplies auth.uid() where needed).
 */
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
    const { rows } = await client.query(sql);
    await client.query("rollback");
    return { ok: true, rows };
  } catch (err) {
    await client.query("rollback").catch(() => {});
    return { ok: false, code: err.code, message: err.message };
  }
}

try {
  await client.connect();
  console.error("\n== db:doctor — live authorization probe ==\n");

  // ------------------------------------------------------------------
  // 0. Migration state: which migration files has the database seen?
  //    (db-push applies files in name order; we fingerprint content.)
  // ------------------------------------------------------------------
  const dir = join(process.cwd(), "supabase", "migrations");
  const files = readdirSync(dir).filter((f) => f.endsWith(".sql")).sort();
  for (const file of files) {
    const sql = readFileSync(join(dir, file), "utf8");
    // Cheap fingerprint: count a marker statement each migration owns.
    const markers = [...sql.matchAll(/create policy "([^"]+)"/g)].map((m) => m[1]);
    let applied = 0;
    for (const marker of markers) {
      const { rows } = await client.query(
        "select 1 from pg_policies where schemaname='public' and policyname=$1 limit 1",
        [marker]
      );
      if (rows.length > 0) applied += 1;
    }
    const total = markers.length;
    if (total === 0) {
      console.error(`  • ${file}: no policies to fingerprint (skipped)`);
    } else if (applied === total) {
      passes += 1;
      console.error(`  ✓ ${file}: fully applied (${applied}/${total} policies present)`);
    } else {
      failures += 1;
      console.error(
        `  ✗ ${file}: PARTIALLY APPLIED — ${applied}/${total} expected policies exist. ` +
          `Re-run: npm run db:push`
      );
    }
  }

  // ------------------------------------------------------------------
  // 1. RLS enabled on every protected table
  // ------------------------------------------------------------------
  console.error("\nRLS status:");
  const { rows: rlsRows } = await client.query(
    `select tablename, rowsecurity from pg_tables
      where schemaname='public' and tablename = any($1)`,
    [TABLES]
  );
  for (const t of TABLES) {
    const row = rlsRows.find((r) => r.tablename === t);
    report(row?.rowsecurity === true, `${t}`, row?.rowsecurity ? "RLS enabled" : "RLS DISABLED — run 0003!");
  }

  // ------------------------------------------------------------------
  // 2. Table grants per role (the 42501 layer)
  // ------------------------------------------------------------------
  console.error("\nTable grants:");
  const { rows: grantRows } = await client.query(
    `select table_name, grantee, privilege_type from information_schema.role_table_grants
      where table_schema='public' and table_name = any($1)
        and grantee in ('anon','authenticated','service_role')`,
    [TABLES]
  );
  const hasGrant = (table, role, privilege) =>
    grantRows.some((g) => g.table_name === table && g.grantee === role && g.privilege_type === privilege);

  for (const t of TABLES) {
    // anon must have nothing.
    const anonGrants = grantRows.filter((g) => g.table_name === t && g.grantee === "anon");
    report(anonGrants.length === 0, `${t}: anon has no access`, anonGrants.length ? anonGrants.map((g) => g.privilege_type).join(",") : "clean");

    // authenticated must have SELECT (42501 on reads = missing this).
    report(hasGrant(t, "authenticated", "SELECT"), `${t}: authenticated SELECT`, hasGrant(t, "authenticated", "SELECT") ? "present" : "MISSING → 42501 in the app");

    // audit_logs: authenticated must NOT have INSERT/UPDATE/DELETE (append-only).
    if (t === "audit_logs") {
      const writes = ["INSERT", "UPDATE", "DELETE"].filter((p) => hasGrant(t, "authenticated", p));
      report(writes.length === 0, `${t}: authenticated has no write grants (append-only)`, writes.length ? `unexpected: ${writes.join(",")}` : "clean");
    }
    // profiles: authenticated UPDATE limited to non-security columns.
    if (t === "profiles") {
      const colGrants = await client.query(
        `select privilege_type from information_schema.column_privileges
          where table_schema='public' and table_name='profiles'
            and grantee='authenticated' and column_name in ('status','is_platform_admin')`
      );
      report(colGrants.rows.length === 0, `${t}: authenticated cannot update status/is_platform_admin columns`, colGrants.rows.length ? "ESCALATION POSSIBLE" : "clean");
    }

    // service_role must have full access.
    const srOk = ["SELECT", "INSERT", "UPDATE", "DELETE"].every((p) => hasGrant(t, "service_role", p));
    report(srOk, `${t}: service_role full access`, srOk ? "present" : "MISSING (server-side writes would fail)");
  }

  // ------------------------------------------------------------------
  // 3. EXECUTE grants on policy helpers + app RPCs
  // ------------------------------------------------------------------
  console.error("\nFunction EXECUTE grants:");
  const fns = [
    "is_platform_admin()",
    "is_team_member(uuid)",
    "is_team_editable(uuid)",
    "shares_team_with_me(uuid)",
    "ensure_profile()",
    "touch_login()",
    "claim_first_admin()",
    "log_audit(text,uuid,uuid,jsonb)",
    "update_member_field(uuid,text,text)",
    "admin_action(text,uuid,uuid,uuid,jsonb,uuid)",
  ];
  for (const fn of fns) {
    const name = fn.split("(")[0];
    const { rows } = await client.query(
      `select 1 from information_schema.role_usage_grants
        where object_schema='public' and object_name=$1 and object_type='FUNCTION'
          and grantee='authenticated' and privilege_type='EXECUTE' limit 1`,
      [name]
    );
    report(rows.length > 0, `${name} executable by authenticated`, rows.length ? "present" : "MISSING → 42501 during policy evaluation / RPC calls");
  }

  // ------------------------------------------------------------------
  // 4. THE PROOF — simulate the frontend's exact requests per role
  // ------------------------------------------------------------------
  console.error("\nLive role simulation (frontend-equivalent requests):");

  // anon: every table must be denied (42501 expected = PASS for security).
  for (const t of TABLES) {
    const r = await probe("anon", `select * from public.${t} limit 1;`);
    report(!r.ok && r.code === "42501", `${t} as anon: denied`, r.ok ? "UNEXPECTEDLY READABLE" : `42501 (correct)`);
  }

  // authenticated without claims: SELECT must execute (grants+RLS valid);
  // zero rows without a JWT is the correct RLS outcome, 42501 is the bug.
  for (const t of TABLES) {
    const r = await probe("authenticated", `select * from public.${t} limit 1;`);
    report(r.ok, `${t} as authenticated: SELECT executes`, r.ok ? `ok (${r.rows?.length ?? 0} rows without session — RLS scopes the rest)` : `${r.code}: ${r.message}`);
  }

  // Mass tables: authenticated must NOT have write grants (RPC-only writes).
  for (const t of MASS_TABLES) {
    const r = await probe("authenticated", `insert into public.${t} default values;`);
    report(!r.ok && r.code === "42501", `${t} as authenticated: INSERT denied (writes go through RPCs)`, !r.ok && r.code === "42501" ? "42501 (correct)" : r.ok ? "UNEXPECTEDLY WRITABLE" : `${r.code} (acceptable, but expected 42501)`);
  }

  // authenticated with a session-shaped JWT claim: policies evaluate.
  const { rows: adminRows } = await client.query(
    `select p.id from public.profiles p where p.is_platform_admin order by p.created_at asc limit 1`
  );
  if (adminRows.length > 0) {
    const adminId = adminRows[0].id;
    const claims = { sub: adminId, role: "authenticated" };
    for (const t of TABLES) {
      const r = await probe("authenticated", `select count(*) as n from public.${t};`, claims);
      report(r.ok, `${t} as authenticated ADMIN session`, r.ok ? `${r.rows?.[0]?.n} visible rows` : `${r.code}: ${r.message}`);
    }
    // Admin must actually SEE audit rows (the production complaint).
    const audit = await probe("authenticated", `select id, action from public.audit_logs order by created_at desc limit 5;`, claims);
    report(audit.ok, "audit_logs readable by admin session (the failing request)", audit.ok ? `${audit.rows?.length} recent events visible` : `${audit.code}: ${audit.message}`);
    // Admin must see team_members (the second failing request).
    const tm = await probe("authenticated", `select id from public.team_members limit 5;`, claims);
    report(tm.ok, "team_members readable by admin session (the failing request)", tm.ok ? `${tm.rows?.length} rows visible` : `${tm.code}: ${tm.message}`);

    // Mass-sheet RPCs must be executable by the admin session (grants on functions).
    const rpcs = [
      ["claim_mass_slot", "null::uuid, null::text"],
      ["unclaim_mass_slot", "null::uuid"],
      ["save_mass_sheet", "null::uuid, null::jsonb"],
      ["duplicate_mass_sheet", "null::uuid"],
      ["set_mass_sheet_status", "null::uuid, null::text"],
      ["admin_set_slot_assignment", "null::uuid, null::uuid, null::text"],
    ];
    for (const [fn, args] of rpcs) {
      const r = await probe("authenticated", `select public.${fn}(${args});`, claims);
      report(r.ok, `${fn} executable by authenticated`, r.ok ? "granted" : `${r.code}: ${r.message}`);
    }
  } else {
    console.error("  • No admin profile exists yet — register the first account to complete admin-session probes.");
  }

  // -------------------------------------------------------------- ----
  // 5. Recursion guard: confirm no policy self-references its table
  // ------------------------------------------------------------------
  console.error("\nRecursion check (42P17):");
  const { rows: polRows } = await client.query(
    `select tablename, policyname, qual, with_check from pg_policies where schemaname='public'`
  );
  for (const p of polRows) {
    const expr = `${p.qual ?? ""} ${p.with_check ?? ""}`;
    const selfRef = new RegExp(`from\\s+public\\.${p.tablename}\\b`).test(expr) ||
                    new RegExp(`update\\s+public\\.${p.tablename}\\b`).test(expr);
    report(!selfRef, `${p.tablename} / ${p.policyname}: no self-reference`, selfRef ? "RECURSION RISK" : "safe");
  }

  console.error(
    `\n== Result: ${passes} passed, ${failures} failed ==\n` +
      (failures === 0
        ? "Database authorization matches the application contract.\n"
        : "Apply the repair, then re-run:  npm run db:push && npm run db:doctor\n")
  );
  process.exitCode = failures === 0 ? 0 : 1;
} catch (err) {
  console.error("db:doctor could not complete:", err.message);
  process.exitCode = 1;
} finally {
  await client.end().catch(() => {});
}
