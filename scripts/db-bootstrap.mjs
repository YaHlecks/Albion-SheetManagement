#!/usr/bin/env node
/**
 * One-time operator step: grant the platform-admin role to an existing,
 * registered account.
 *
 *   npm run db:bootstrap -- admin@example.com
 *
 * Requires DATABASE_URL (Postgres connection string). The operation is
 * idempotent and writes an auditable PERMISSION_CHANGED event. It never
 * creates credentials — the account must already exist via normal
 * registration.
 */
import { readFileSync } from "node:fs";
import { join } from "node:path";

const email = process.argv[2]?.trim().toLowerCase();
if (!email || !email.includes("@")) {
  console.error("Usage: npm run db:bootstrap -- admin@example.com");
  process.exit(1);
}

const url = process.env.DATABASE_URL;
if (!url) {
  console.error(
    "DATABASE_URL is not set.\n" +
      "Set it to your Postgres connection string (Supabase → Project Settings → Database)\n" +
      "and re-run this command.\n\n" +
      "Alternative: open supabase/bootstrap-admin.sql in the Supabase SQL Editor,\n" +
      "replace the email at the top, and run it there."
  );
  process.exit(1);
}

let Client;
try {
  ({ Client } = await import("pg"));
} catch {
  console.error("The 'pg' package is not installed. Run:\n  npm install --no-save pg\nThen re-run this command.");
  process.exit(1);
}

const sql = readFileSync(join(process.cwd(), "supabase", "bootstrap-admin.sql"), "utf8")
  .replace(
    /v_email text := '[^']*';/,
    `v_email text := '${email.replace(/'/g, "''")}';`
  );

const client = new Client({
  connectionString: url,
  ssl: url.includes("localhost") || url.includes("127.0.0.1") ? false : { rejectUnauthorized: false },
});

await client.connect();
try {
  await client.query("begin");
  await client.query(sql);
  const { rows } = await client.query(
    "select id, ign, status, is_platform_admin from public.profiles p join auth.users u on u.id = p.id where lower(u.email) = $1",
    [email]
  );
  await client.query("commit");

  const row = rows[0];
  if (!row) {
    console.error(`No account found for ${email}. Register through /register first.`);
    process.exitCode = 1;
    await client.query("rollback");
  } else {
    console.log(`Bootstrap complete: ${email}`);
    console.log(`  IGN               : ${row.ign}`);
    console.log(`  status            : ${row.status}`);
    console.log(`  is_platform_admin : ${row.is_platform_admin}`);
    if (!row.is_platform_admin || row.status !== "approved") {
      console.error("  ! The promotion did not apply — check the SQL error above.");
      process.exitCode = 1;
    }
  }
} catch (err) {
  await client.query("rollback").catch(() => {});
  console.error("Bootstrap failed:", err.message);
  process.exitCode = 1;
} finally {
  await client.end();
}
